/**
 * Integration tests for the event dispatcher.
 *
 * Uses an in-memory SQLite database (better-sqlite3) to test real
 * deduplication, locking, and event recovery. Flow is mocked to
 * isolate dispatcher behavior.
 *
 * Tests cover:
 *   1. Single event → handled, adapter.send called
 *   2. Duplicate event → accept returns null, no double processing
 *   3. Two events same conversation → processed sequentially
 *   4. recover() reprocesses 'received' events
 *   5. State version mismatch → old button rejected
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { createDispatcher } from '../../src/bot/dispatcher.js';

// ── Schema (subset of 001_init.sql for inbound_events) ───────────────────

const SCHEMA = `
CREATE TABLE IF NOT EXISTS inbound_events (
  platform TEXT NOT NULL,
  event_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',
  received_at TEXT NOT NULL,
  PRIMARY KEY (platform, event_id)
);
`;

// ── Helpers ──────────────────────────────────────────────────────────────

function makeEvent(overrides = {}) {
  return {
    platform: 'max',
    userId: 'user-1',
    peerId: 'peer-1',
    eventId: `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    kind: 'text',
    text: 'Hello',
    ...overrides,
  };
}

function createMockAdapter() {
  return {
    send: vi.fn(async () => {}),
  };
}

function createMockFlow() {
  const replies = [];
  return {
    handle: vi.fn(async (conversation, event) => {
      // Simulate state transitions
      if (event.kind === 'action' && event.action?.a === 'continue') {
        conversation.state = 'choose_type';
        conversation.stateVersion++;
      }
      if (event.kind === 'text') {
        conversation.state = 'collecting';
        conversation.stateVersion++;
      }
      return [{ text: 'mock reply' }];
    }),
    _replies: replies,
  };
}

function createMockLog() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('dispatcher', () => {
  let db;
  let dispatcher;
  let flow;
  let adapter;
  let log;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(SCHEMA);
    flow = createMockFlow();
    adapter = createMockAdapter();
    log = createMockLog();
    dispatcher = createDispatcher({ db, flow, adapters: new Map([['max', adapter]]), log });
  });

  afterEach(() => {
    db.close();
  });

  // ── 1. Single event → handled, adapter.send called

  it('single event → accepted and processed', async () => {
    const event = makeEvent();
    const accepted = dispatcher.accept(event, { raw: 'data' });
    expect(accepted).toEqual(event);

    await dispatcher.run(event, adapter);
    expect(flow.handle).toHaveBeenCalled();
    expect(adapter.send).toHaveBeenCalledWith(
      'peer-1',
      [{ text: 'mock reply' }],
      { event }
    );
  });

  // ── 2. Duplicate event → accept returns null, no double processing

  it('duplicate event → rejected', () => {
    const event = makeEvent({ eventId: 'dup-1' });
    const first = dispatcher.accept(event, { raw: 'data' });
    expect(first).toEqual(event);

    const second = dispatcher.accept(event, { raw: 'data' });
    expect(second).toBeNull();
  });

  // ── 3. Two events same conversation → processed sequentially

  it('two events same conversation → processed sequentially', async () => {
    const event1 = makeEvent({ eventId: 'evt-1', text: 'first' });
    const event2 = makeEvent({ eventId: 'evt-2', text: 'second' });

    dispatcher.accept(event1, { raw: 1 });
    dispatcher.accept(event2, { raw: 2 });

    // Both should be processed (sequentially due to lock)
    await dispatcher.run(event1, adapter);
    await dispatcher.run(event2, adapter);

    expect(flow.handle).toHaveBeenCalledTimes(2);
  });

  // ── 4. recover() reprocesses 'received' events

  it('recover() reprocesses received events', async () => {
    // Insert events directly as "received" (simulating server restart)
    db.prepare(`
      INSERT INTO inbound_events (platform, event_id, payload, status, received_at)
      VALUES (?, ?, ?, 'received', ?)
    `).run('max', 'evt-r1', JSON.stringify(makeEvent({ eventId: 'evt-r1' })), new Date().toISOString());
    db.prepare(`
      INSERT INTO inbound_events (platform, event_id, payload, status, received_at)
      VALUES (?, ?, ?, 'received', ?)
    `).run('max', 'evt-r2', JSON.stringify(makeEvent({ eventId: 'evt-r2' })), new Date().toISOString());

    const adapters = new Map([['max', adapter]]);
    await dispatcher.recover(adapters);

    expect(flow.handle).toHaveBeenCalledTimes(2);
  });

  // ── 5. State version mismatch → old button rejected

  it('state version mismatch → button rejected', async () => {
    const event = makeEvent({
      kind: 'action',
      action: { a: 'continue', r: 0 },
    });
    dispatcher.accept(event, { raw: 'data' });

    // Get conversation and set a higher stateVersion
    const conv = dispatcher.getConversation('max', 'peer-1');
    conv.stateVersion = 5;

    await dispatcher.run(event, adapter);

    // Should send stale button message, not process through flow
    expect(adapter.send).toHaveBeenCalledWith(
      'peer-1',
      [{ text: expect.stringContaining('предыдущему шагу'), format: 'html' }],
      { event }
    );
    expect(flow.handle).not.toHaveBeenCalled();
  });

  // ── 6. Flow error → markFailed + error message sent

  it('flow error → marks event as failed and sends error', async () => {
    flow.handle.mockRejectedValueOnce(new Error('boom'));

    const event = makeEvent();
    dispatcher.accept(event, { raw: 'data' });

    await dispatcher.run(event, adapter);

    // Event should be marked as failed
    const row = db.prepare('SELECT status FROM inbound_events WHERE platform = ? AND event_id = ?')
      .get('max', event.eventId);
    expect(row.status).toBe('failed');

    // Error message sent to user
    expect(adapter.send).toHaveBeenCalledWith(
      'peer-1',
      [{ text: expect.stringContaining('ошибка'), format: 'html' }],
      { event }
    );
  });

  // ── 7. findByDocumentId finds conversation after run()

  it('findByDocumentId returns conversation after event processing', async () => {
    // Simulate a flow that sets documentId on the conversation
    flow.handle.mockImplementationOnce(async (conversation, event) => {
      conversation.documentId = 'doc-123';
      return [{ text: 'reply' }];
    });

    const event = makeEvent();
    dispatcher.accept(event, { raw: 'data' });
    await dispatcher.run(event, adapter);

    const found = dispatcher.findByDocumentId('doc-123');
    expect(found).not.toBeNull();
    expect(found.platform).toBe('max');
    expect(found.peerId).toBe('peer-1');
  });

  it('findByDocumentId returns null for unknown doc', () => {
    const found = dispatcher.findByDocumentId('nonexistent');
    expect(found).toBeNull();
  });

  // ── 8. getConversation creates default conversation

  it('getConversation creates idle conversation', () => {
    const conv = dispatcher.getConversation('vk', '42');
    expect(conv.state).toBe('idle');
    expect(conv.stateVersion).toBe(0);
    expect(conv.documentId).toBeNull();
    expect(conv.platform).toBe('vk');
    expect(conv.peerId).toBe('42');
  });

  it('getConversation returns same instance for same key', () => {
    const c1 = dispatcher.getConversation('max', '100');
    const c2 = dispatcher.getConversation('max', '100');
    expect(c1).toBe(c2);
  });
});
