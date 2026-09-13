/**
 * Bots end-to-end — the wired runtime driven through an in-memory messenger adapter.
 *
 * The adapter is registered with the very same dispatcher, flow, document service and DOCX
 * generator as the MAX and VK adapters, so this test covers the bot path without platform tokens.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import { createRuntime } from '../../src/runtime.js';
import { decode } from '../../src/bot/payload.js';
import { createMemoryAdapter } from '../helpers/memoryAdapter.js';

// Логи теста молчат по умолчанию; TEST_LOG_LEVEL=debug включает их для разбора падения
const silentLog = pino({ level: process.env.TEST_LOG_LEVEL ?? 'silent' });

// Весь backend поднимается прямо здесь с временной базой: тест не зависит
// от запущенного снаружи процесса и от ключей из .env.
const testEnv = (dataDir) => ({
  PORT: 0, DATA_DIR: dataDir, DEBUG_COMMANDS: true,
  AI_PROVIDER: 'mock', AI_FAULT: 'off', AI_TIMEOUT_MS: 5000,
  MAX_ENABLED: false, VK_ENABLED: false,
  CLEANUP_ENABLED: false, CLEANUP_FILE_MAX_AGE_HOURS: 24, CLEANUP_LOG_MAX_AGE_DAYS: 30,
  API_KEY: 'bots-test-api-key', DOCUMENT_POLL_INTERVAL_MS: 100,
});

const COMMANDS = { '/start': 'start', '/help': 'help', '/new': 'new', '/ai_fail': 'ai_fail' };

let runtime;
let dataDir;

afterEach(async () => {
  if (runtime) await runtime.close();
  runtime = null;
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

/** Starts the runtime with a memory adapter and returns helpers that talk to it like a messenger would. */
function startBot() {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bots-test-'));
  runtime = createRuntime(testEnv(dataDir), { log: silentLog });

  const adapter = createMemoryAdapter({ platform: 'max', files: runtime.files });
  runtime.adapters.set('max', adapter);

  const peer = 'tester';
  let seq = 0;
  const deliver = async (event) => {
    const full = {
      platform: 'max', peerId: peer, userId: peer, eventId: `test:${++seq}`, meta: {},
      profile: { firstName: 'Иван', lastName: 'Христофоров' }, ...event,
    };
    const accepted = runtime.dispatcher.accept(full, full);
    if (accepted) await runtime.dispatcher.run(accepted, adapter);
  };

  const state = () => runtime.dispatcher.getConversation('max', peer).state;
  const messages = () => adapter.messages;
  const send = (text) => deliver(COMMANDS[text] ? { kind: 'command', command: COMMANDS[text], text } : { kind: 'text', text });
  const press = async (label) => {
    // Template buttons carry a description after the name, so a prefix match is enough.
    const button = messages().flatMap((m) => (m.buttons ?? []).flat()).reverse().find((b) => b.label.startsWith(label));
    expect(button, `кнопка «${label}»`).toBeDefined();
    await deliver({ kind: 'action', action: decode(button.action) });
  };
  const waitFor = async (predicate, timeoutMs = 5000) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (predicate(state())) return;
      if (Date.now() > deadline) throw new Error(`не дождались, состояние: ${state()}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };
  return { adapter, peer, state, messages, send, press, waitFor };
}

describe('bots end-to-end (memory adapter)', () => {
  it('greets by name with an illustration and walks the draft to a DOCX', async () => {
    const bot = startBot();

    await bot.send('/start');
    const greeting = bot.messages().at(-1);
    expect(greeting.text).toContain('Иван Христофоров');
    expect(greeting.image).toEqual({ name: 'greeting' });

    // Черновик присылается сразу после приветствия — отдельного шага «Создать документ» нет
    expect(greeting.buttons).toBeUndefined();
    await bot.send('Прошу выделить 5000 руб. на канцтовары до 20.09.2026.');
    await bot.press('Готово');
    await bot.press('Служебная записка');
    await bot.press('Классический');

    // The AI runs in a background job; the notifier pushes the next question.
    await bot.waitFor((s) => ['asking_field', 'ready'].includes(s), 8000);
    if (bot.state() === 'asking_field') {
      await bot.send('Директору Иванову И. И.');
      await bot.press('Пропустить все вопросы');
    }
    await bot.waitFor((s) => s === 'ready');

    const ready = bot.messages().find((m) => m.image?.name === 'ready');
    expect(ready?.text).toContain('Документ готов');
    const file = bot.messages().find((m) => m.file)?.file;
    expect(file, 'сообщение с файлом').toBeDefined();
    expect(fs.readFileSync(file.path).subarray(0, 2).toString()).toBe('PK'); // ZIP signature of a DOCX

    // The user's answer must reach the document, not stay a placeholder.
    const doc = runtime.db.prepare('SELECT user_fields FROM documents LIMIT 1').get();
    expect(JSON.parse(doc.user_fields)['Адресат']).toBe('Директору Иванову И. И.');
  });

  it('answers a button from an earlier step with the buttons of the current step', async () => {
    const bot = startBot();

    await bot.send('Прошу выделить ноутбук для нового сотрудника.');
    await bot.press('Готово');
    expect(bot.state()).toBe('choose_type');

    // «Показать черновик» остался под сообщением с шага черновика
    await bot.press('Показать черновик');

    const reply = bot.messages().at(-1);
    expect(reply.text).toContain('предыдущему шагу');
    expect(reply.buttons.flat().map((b) => b.label)).toContain('Служебная записка');
    expect(bot.state()).toBe('choose_type');
  });

  it('keeps the draft and offers a retry when the AI fails (/ai_fail)', async () => {
    const bot = startBot();

    await bot.send('Прошу согласовать отпуск с 1 октября.');
    await bot.send('/ai_fail');
    await bot.press('Готово');
    await bot.press('Докладная записка');
    await bot.press('Классический');

    await bot.waitFor((s) => s === 'ai_failed', 8000);
    const failure = bot.messages().at(-1);
    expect(failure.text).toContain('недоступен');
    expect(failure.image).toEqual({ name: 'ai-error' });
    expect(failure.buttons.flat().map((b) => b.label)).toContain('Повторить');

    const doc = runtime.db.prepare('SELECT source_text, status FROM documents LIMIT 1').get();
    expect(doc.source_text).toBe('Прошу согласовать отпуск с 1 октября.');
    expect(doc.status).toBe('ai_failed');

    await bot.press('Повторить');
    await bot.waitFor((s) => ['asking_field', 'ready'].includes(s), 8000);
  }, 25000);

  it('offers «Отправить ещё раз» without reprocessing when the file cannot be sent', async () => {
    const bot = startBot();

    await bot.send('Справка о выполнении работ за сентябрь.');
    await bot.press('Готово');
    await bot.press('Информационная справка');
    bot.adapter.armFileFailure(bot.peer);
    await bot.press('Классический');

    await bot.waitFor((s) => s === 'asking_field' || s === 'delivery_failed', 8000);
    if (bot.state() === 'asking_field') await bot.press('Пропустить все вопросы');
    await bot.waitFor((s) => s === 'delivery_failed');

    const before = runtime.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE kind = 'process'").get().n;
    await bot.press('Отправить ещё раз');
    await bot.waitFor((s) => s === 'ready');
    expect(bot.messages().at(-1).file).toBeDefined();
    // No new AI job: the same file is sent again.
    expect(runtime.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE kind = 'process'").get().n).toBe(before);
  });
});
