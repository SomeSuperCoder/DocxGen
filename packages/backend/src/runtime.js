/**
 * Composition root — wires every module into a running service.
 *
 * Layers (each one only knows the layer below):
 *   HTTP / bot adapters → dispatcher + flow → documentService → queue/worker → AI, DOCX, SQLite
 *
 * Clients: REST API (web), MAX bot and VK bot.
 * Bots are optional — enable them with MAX_ENABLED / VK_ENABLED in .env.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { env } from './config/env.js';
import { trustExtraCa } from './config/extraCa.js';
import { log } from './logger.js';
import { createApp } from './app.js';
import { openDb } from './db/index.js';
import { loadDocTypes } from './catalog/docTypes.js';
import { loadTemplates } from './catalog/templates.js';
import { createQueue } from './jobs/queue.js';
import { startWorker } from './jobs/worker.js';
import { createProcessDocumentHandler } from './jobs/handlers/processDocument.js';
import { createCleanupHandler } from './jobs/handlers/cleanup.js';
import { createFileStorage } from './storage/files.js';
import { createDocumentService } from './core/documentService.js';
import { renderDocx } from './docx/render.js';
import { createAiProvider } from './ai/provider.js';
import { AiFaultManager } from './ai/faults.js';
import { processDraft } from './ai/processDraft.js';
import { createLocalDocumentServiceClient } from './client/localDocumentServiceClient.js';
import { createFlow } from './bot/flow.js';
import { createDispatcher } from './bot/dispatcher.js';
import { createNotifier } from './bot/notifier.js';
import { createMaxClient } from './adapters/max/client.js';
import { createMaxAdapter } from './adapters/max/adapter.js';
import { createMaxWebhookRouter } from './adapters/max/webhook.js';
import { createMaxPoller } from './adapters/max/poller.js';
import { toInboundEvents } from './adapters/max/normalize.js';
import { createVkClient } from './adapters/vk/client.js';
import { createVkAdapter } from './adapters/vk/adapter.js';
import { createVkCallbackRouter } from './adapters/vk/callback.js';
import { createVkLongPoller } from './adapters/vk/longpoll.js';
import { toInboundEvent } from './adapters/vk/normalize.js';
import { createBotImages } from './adapters/common/botImages.js';
import { createBotTranscriber } from './audio/botAudio.js';
import { createAudioClient } from './audio/audioClient.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Build the whole service without listening on a port — used by entry points and tests.
 * @param {object} [config] - env overrides
 * @param {{ db?: object, log?: object }} [options]
 */
export function createRuntime(config = env, { db: passedDb, log: logger = log } = {}) {
  // DATA_DIR may be configured relatively. Resolve it once so the database,
  // storage and cleanup worker always operate on the same directory regardless
  // of the process working directory.
  const dataDir = path.resolve(config.DATA_DIR);
  const db = passedDb ?? openDb(path.join(dataDir, 'app.sqlite'), { log: logger });

  const docTypes = loadDocTypes(path.join(ROOT, 'config/doc-types'), logger);
  const templates = loadTemplates(path.join(ROOT, 'config/templates'), logger);
  const queue = createQueue(db);
  const fileStorage = createFileStorage(dataDir);
  const documentService = createDocumentService({ db, queue, fileStorage, docTypes, templates, renderDocx, log: logger });

  const provider = createAiProvider(config);
  const faultManager = new AiFaultManager(config);

  const cleanup = createCleanupHandler({ db, dataDir, log: logger, env: config });
  const handlers = {
    process: createProcessDocumentHandler({ documentService, processDraft, docTypes, provider, faultManager, log: logger }),
  };
  const worker = startWorker({ db, queue, handlers, log: logger });

  // MAX, VK and the web API share this document service in-process.
  // There is no separate backend process for a messenger: adapters only translate
  // platform events and delegate document operations to this core service.
  const docServiceClient = createLocalDocumentServiceClient({
    documentService,
    docTypes,
    templates,
    faultManager,
  });

  // Голосовые сообщения ботов и микрофон на сайте распознаёт один аудиосервис (Vosk).
  const audioService = { serviceUrl: `http://127.0.0.1:${config.AUDIO_SERVICE_PORT ?? 3005}`, apiKey: config.API_KEY };
  const audioClient = createAudioClient(audioService);
  const transcribeAudio = createBotTranscriber({ ...audioService, maxBytes: config.AUDIO_MAX_BYTES });
  const flow = createFlow({ docServiceClient, docTypes, templates, faultManager, debugCommands: config.DEBUG_COMMANDS, log: logger, transcribeAudio });
  const adapters = new Map();
  const dispatcher = createDispatcher({ db, flow, adapters, log: logger });
  const notifier = createNotifier({ dispatcher, flow, adapters, docServiceClient, log: logger, pollIntervalMs: config.DOCUMENT_POLL_INTERVAL_MS });

  // Wire notifier into flow for polling support (avoids circular dependency)
  flow.setNotifier(notifier);

  // Adapters read files by id — the row carries the path and the human-readable filename.
  const files = { get: (id) => db.prepare('SELECT * FROM files WHERE id = ?').get(id) ?? null };
  // Иллюстрации сообщений бота (приветствие, выбор типа и шаблона, готово, сбой ИИ)
  const botImages = createBotImages({ dir: path.join(ROOT, 'assets/bot') });
  const routers = [];
  const pollers = [];
  let maxClient = null;
  let cleanupTimer = null;

  if (config.CLEANUP_ENABLED) {
    cleanup();
    const intervalMs = config.CLEANUP_INTERVAL_MS || 60 * 60 * 1000;
    cleanupTimer = setInterval(cleanup, intervalMs);
    cleanupTimer.unref?.();
  }

  if (config.MAX_ENABLED) {
    // API MAX работает на сертификате УЦ Минцифры — его нет в наборе Node.js.
    trustExtraCa(config.MAX_CA_FILE ? path.resolve(ROOT, config.MAX_CA_FILE) : '', logger);
    maxClient = createMaxClient({ baseUrl: config.MAX_API_URL, token: config.MAX_TOKEN });
    const adapter = createMaxAdapter({ db, client: maxClient, files, log: logger, images: botImages });
    adapters.set('max', adapter);
    if (config.MAX_MODE === 'webhook') {
      routers.push(createMaxWebhookRouter({ secret: config.MAX_WEBHOOK_SECRET, dispatcher, adapter, log: logger }));
    } else {
      pollers.push(createMaxPoller({
        client: maxClient,
        onEvent: async (raw) => {
          const events = toInboundEvents(raw);
          if (!events.length && raw?.update_type === 'message_created' && !raw.message) {
            // Так Bot API MAX присылает голосовое: без чата и отправителя — ответить пользователю нельзя.
            logger.info({ timestamp: raw.timestamp }, 'MAX: сообщение без содержимого (голосовое?) — Bot API не передаёт его боту');
          }
          for (const event of events) {
            const accepted = dispatcher.accept(event, raw);
            if (accepted) await dispatcher.run(accepted, adapter);
          }
        },
        log: logger,
      }));
    }
  }

  if (config.VK_ENABLED) {
    const client = createVkClient({ token: config.VK_TOKEN, apiVersion: config.VK_API_VERSION });
    const adapter = createVkAdapter({ db, client, files, log: logger, images: botImages });
    adapters.set('vk', adapter);
    if (config.VK_MODE === 'callback') {
      routers.push(createVkCallbackRouter({ groupId: config.VK_GROUP_ID, secret: config.VK_CALLBACK_SECRET, confirmationCode: config.VK_CONFIRMATION_CODE, dispatcher, adapter, log: logger }));
    } else {
      pollers.push(createVkLongPoller({
        client,
        groupId: config.VK_GROUP_ID,
        onEvent: async (raw) => {
          const event = toInboundEvent(raw);
          const accepted = event && dispatcher.accept(event, raw);
          if (accepted) await dispatcher.run(accepted, adapter);
        },
        log: logger,
      }));
    }
  }

  const app = createApp({ log: logger, deps: { documentService, docTypes, templates, fileStorage, db, log: logger, apiKey: config.API_KEY, audioClient, audioMaxBytes: config.AUDIO_MAX_BYTES, routers } });

  for (const poller of pollers) void poller.start();
  // Events accepted before a restart are processed once the adapters are registered.
  dispatcher.recover(adapters).catch((err) => logger.error({ err }, 'inbound events recovery failed'));

  return {
    app, db, documentService, docTypes, templates, queue, worker, flow, dispatcher, adapters, provider, faultManager, files, pollers,
    async close() {
      notifier.stop();
      if (cleanupTimer) clearInterval(cleanupTimer);
      for (const poller of pollers) poller.stop();
      await worker.stop();
      db.close();
    },
  };
}
