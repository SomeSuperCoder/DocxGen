/**
 * Опрос MAX (polling) и ВК (long poll): долгая обработка одного события — например,
 * распознавание голосового — не должна задерживать остальных собеседников бота.
 * Поллеры и диспетчер настоящие (SQLite в памяти); подменены клиенты платформ и диалог.
 */
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMaxPoller } from '../../src/adapters/max/poller.js';
import { createVkLongPoller } from '../../src/adapters/vk/longpoll.js';
import { createDispatcher } from '../../src/bot/dispatcher.js';

const SCHEMA = `
CREATE TABLE inbound_events (
  platform TEXT NOT NULL, event_id TEXT NOT NULL, payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received', received_at TEXT NOT NULL,
  PRIMARY KEY (platform, event_id)
);`;

const silentLog = { debug: () => {}, info: () => {}, warn: () => {}, error: vi.fn() };

/** Ждёт выполнения условия, не полагаясь на фиксированную паузу. */
async function until(condition, ms = 2000) {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/**
 * Диалог, в котором сообщение «медленно» обрабатывается, пока тест не отпустит его —
 * как голосовое, которое распознаёт Vosk.
 */
function slowFlow() {
  const handled = [];
  let releaseSlow;
  const slow = new Promise((resolve) => { releaseSlow = resolve; });
  return {
    handled,
    releaseSlow: () => releaseSlow(),
    async handle(conversation, event) {
      if (event.text === 'медленно') await slow;
      handled.push(`${event.peerId}:${event.text}`);
      return [];
    },
  };
}

function setup() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  const flow = slowFlow();
  const adapter = { send: async () => {} };
  const dispatcher = createDispatcher({ db, flow, adapters: new Map(), log: silentLog });
  /** Тот же путь, что в runtime.js: accept, затем run. */
  const onEvent = async (event) => {
    const accepted = dispatcher.accept(event, event);
    if (accepted) await dispatcher.run(accepted, adapter);
  };
  return { flow, onEvent };
}

const event = (peerId, text, id) => ({ platform: 'max', peerId, userId: peerId, eventId: id, kind: 'text', text });

/** Первый ответ — пачка обновлений, дальше опрос ждёт, пока его не остановят. */
function oneBatch(batch) {
  let calls = 0;
  const waiting = [];
  return {
    next: () => (calls++ === 0 ? Promise.resolve(batch) : new Promise((resolve) => waiting.push(resolve))),
    stop: (empty) => waiting.splice(0).forEach((resolve) => resolve(empty)),
  };
}

let stopPolling = () => {};
afterEach(() => { stopPolling(); silentLog.error.mockClear(); });

describe.each([
  ['MAX polling', (updates, onEvent) => {
    const source = oneBatch({ updates, marker: 1 });
    const poller = createMaxPoller({ client: { getUpdates: () => source.next() }, onEvent, log: silentLog, sleep: async () => {} });
    return { poller, stop: () => source.stop({ updates: [] }) };
  }],
  ['VK long poll', (updates, onEvent) => {
    const source = oneBatch({ ts: '2', updates });
    const client = { api: { groups: { getLongPollServer: async () => ({ server: 'https://lp.vk.test', key: 'k', ts: '1' }) } } };
    const fetchImpl = async () => ({ json: () => source.next() });
    const poller = createVkLongPoller({ client, groupId: '1', onEvent, fetchImpl, log: silentLog, sleep: async () => {} });
    return { poller, stop: () => source.stop({ ts: '3', updates: [] }) };
  }],
])('%s', (_name, startPoller) => {
  it('answers other users while one message is still being handled, keeping each user’s order', async () => {
    const { flow, onEvent } = setup();
    const updates = [event('anna', 'медленно', 'e1'), event('boris', 'привет', 'e2'), event('anna', 'второе', 'e3')];
    const { poller, stop } = startPoller(updates, onEvent);
    stopPolling = () => { poller.stop(); stop(); flow.releaseSlow(); };

    void poller.start();

    await until(() => flow.handled.includes('boris:привет'));
    expect(flow.handled).toEqual(['boris:привет']);

    flow.releaseSlow();
    await until(() => flow.handled.length === 3);
    expect(flow.handled).toEqual(['boris:привет', 'anna:медленно', 'anna:второе']);
  });

  it('handles the rest of the batch when one update fails', async () => {
    const handled = [];
    const onEvent = async (update) => {
      if (update.text === 'сломано') throw new Error('bad update');
      handled.push(update.text);
    };
    const { poller, stop } = startPoller([event('anna', 'сломано', 'e1'), event('boris', 'привет', 'e2')], onEvent);
    stopPolling = () => { poller.stop(); stop(); };

    void poller.start();

    await until(() => handled.includes('привет'));
    expect(silentLog.error).toHaveBeenCalled();
  });
});
