import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DomainError } from './core/errors.js';
import { createVoskTranscriber } from './audio/transcriber.js';
import { readMultipartFile } from './audio/multipart.js';
import { env } from './config/env.js';
import { log } from './logger.js';

const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function createAudioServiceApp({ transcriber, maxBytes = env.AUDIO_MAX_BYTES, apiKey = env.API_KEY, logger = log } = {}) {
  const app = express();
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.post('/api/audio/transcribe', async (req, res, next) => {
    const startedAt = Date.now();
    const owner = `${req.headers['x-owner-platform']}:${req.headers['x-owner-id']}`;
    try {
      if (apiKey && req.headers['x-api-key'] !== apiKey) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid API key' } });
      if (!req.headers['x-owner-platform'] || !req.headers['x-owner-id']) throw DomainError.AUDIO_INVALID('Не указаны владелец и платформа');
      const file = await readMultipartFile(req, maxBytes);
      const result = await transcriber.transcribe(file);
      logger.info({ owner, bytes: file.length, duration: result.duration, chars: result.text.length, ms: Date.now() - startedAt }, 'речь распознана');
      res.json({ ok: true, text: result.text, duration: result.duration });
    } catch (error) {
      logger.warn({ owner, code: error.code, error: error.message, detail: error.detail, ms: Date.now() - startedAt }, 'речь не распознана');
      next(error instanceof DomainError ? error : DomainError.STT_FAILED());
    }
  });
  app.use((error, _req, res, _next) => res.status(error.status ?? 500).json({ error: { code: error.code ?? 'STT_FAILED', message: error.message ?? 'Ошибка распознавания' } }));
  return app;
}

// Сравнение полных путей: на Windows argv[1] содержит обратные слэши, и проверка по «/audio-service.js»
// никогда не срабатывала — процесс молча завершался с кодом 0.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let transcriber;
  const configuredModelPath = path.isAbsolute(env.VOSK_MODEL_PATH)
    ? env.VOSK_MODEL_PATH
    : path.resolve(BACKEND_ROOT, env.VOSK_MODEL_PATH);
  const configuredPython = path.isAbsolute(env.VOSK_PYTHON)
    ? env.VOSK_PYTHON
    : path.resolve(BACKEND_ROOT, env.VOSK_PYTHON);
  try {
    transcriber = await createVoskTranscriber({ modelPath: configuredModelPath, ffmpeg: env.FFMPEG_BIN, maxBytes: env.AUDIO_MAX_BYTES, python: configuredPython });
  } catch (error) {
    // Do not terminate the HTTP process. If Vosk/model setup is incomplete,
    // Vite otherwise reports a non-JSON proxy 502 and hides the real cause.
    // Keep the endpoint alive and return a structured STT_FAILED response.
    log.error({ error: error.message }, 'Audio service unavailable');
    transcriber = { transcribe: async () => { throw DomainError.STT_FAILED(`Сервис распознавания не настроен: ${error.message}`); } };
  }
  const server = createAudioServiceApp({ transcriber }).listen(env.AUDIO_SERVICE_PORT, '127.0.0.1', () => log.info({ port: env.AUDIO_SERVICE_PORT }, 'Audio service started'));
  const stop = () => { server.close(); transcriber.close?.(); };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
}
