/**
 * Event dispatcher — deduplication, locking, and routing for inbound events.
 *
 * The dispatcher is the entry point for all bot events. It:
 *   1. Deduplicates events (INSERT OR IGNORE — idempotent delivery)
 *   2. Acquires a per-conversation lock (sequential processing)
 *   3. Checks button state_version (rejects stale presses)
 *   4. Routes to the flow handler
 *   5. Sends replies via the adapter
 *
 * Two-step design:
 *   accept(event, raw) — synchronous, for webhook response (save event, return)
 *   run(event, adapter) — async, process through flow (can take seconds)
 *
 * Why two steps: webhooks must respond quickly (within platform timeout).
 * The heavy lifting (AI, rendering) happens in run(), which is async.
 *
 * Dependencies are injected (Dependency Inversion):
 *   db — better-sqlite3 Database instance
 *   flow — dialog flow handler (createFlow)
 *   adapters — Map<string, Adapter> (platform → adapter)
 *   log — pino-compatible logger
 */

import { createLockManager } from './lock.js';
import { sendReplies } from './sendReplies.js';
import * as texts from './texts.js';

/**
 * Create the event dispatcher.
 * @param {{ db: object, flow: object, adapters: Map, log: object }} deps
 * @returns {{ accept: function, run: function, recover: function, getConversation: function, findByDocumentId: function }}
 */
export function createDispatcher({ db, flow, adapters, log }) {
  const locks = createLockManager();

  // ── Prepared statements ────────────────────────────────────────────────
  const insertEvent = db.prepare(`
    INSERT OR IGNORE INTO inbound_events (platform, event_id, payload, status, received_at)
    VALUES (@platform, @eventId, @payload, 'received', @now)
  `);
  const markHandled = db.prepare(`
    UPDATE inbound_events SET status = 'handled' WHERE platform = ? AND event_id = ?
  `);
  const markFailed = db.prepare(`
    UPDATE inbound_events SET status = 'failed' WHERE platform = ? AND event_id = ?
  `);
  const getReceived = db.prepare(`
    SELECT * FROM inbound_events WHERE status = 'received'
  `);

  // ── Conversation store (in-memory) ────────────────────────────────────
  const conversations = new Map(); // "platform:peerId" → conversation
  const docToKey = new Map();     // documentId → "platform:peerId"

  /**
   * Get or create conversation for a platform:peerId pair.
   * @param {string} platform
   * @param {string} peerId
   * @returns {object}
   */
  function getConversation(platform, peerId) {
    const key = `${platform}:${peerId}`;
    if (!conversations.has(key)) {
      conversations.set(key, {
        platform,
        peerId,
        userId: peerId,   // in MAX the chat id differs from the user id — updated from the event
        profile: null,    // { firstName, lastName } — used to greet the user by name
        state: 'idle',
        stateVersion: 0,
        documentId: null,
        lastFileId: null,
        pendingField: null,
        pendingQueue: [],
        ctx: {},
      });
    }
    return conversations.get(key);
  }

  /**
   * Remember who is talking: documents are owned by the user, and the greeting uses their name.
   * MAX sends the name inside every event; VK does not, so the adapter looks it up once.
   * @param {object} conversation
   * @param {object} event - InboundEvent
   * @param {object} adapter - platform adapter
   */
  async function rememberUser(conversation, event, adapter) {
    if (event.userId) conversation.userId = String(event.userId);
    if (event.profile?.firstName) { conversation.profile = event.profile; return; }
    if (conversation.profile !== null || typeof adapter.getProfile !== 'function') return;
    // The result (even null) is cached: no lookup on every message.
    conversation.profile = await adapter.getProfile(conversation.userId).catch((err) => {
      log.warn({ error: err.message }, 'profile lookup failed');
      return undefined;
    }) ?? undefined;
  }

  /**
   * Find conversation by documentId (for notifier).
   * @param {string} documentId
   * @returns {object|null}
   */
  function findByDocumentId(documentId) {
    const key = docToKey.get(documentId);
    return key ? conversations.get(key) || null : null;
  }

  /**
   * Index a conversation by its current documentId.
   * @param {object} conversation
   */
  function indexByDocument(conversation) {
    if (conversation.documentId) {
      const key = `${conversation.platform}:${conversation.peerId}`;
      docToKey.set(conversation.documentId, key);
    }
  }

  return {
    /**
     * Accept an inbound event (synchronous — for webhook response).
     * INSERT OR IGNORE ensures idempotent delivery.
     * @param {object} event - InboundEvent
     * @param {object} raw - raw platform event
     * @returns {object|null} event or null if duplicate
     */
    accept(event, raw) {
      const result = insertEvent.run({
        platform: event.platform,
        eventId: event.eventId,
        payload: JSON.stringify(raw),
        now: new Date().toISOString(),
      });

      if (result.changes === 0) {
        log.debug({ platform: event.platform, eventId: event.eventId }, 'событие уже обработано, пропуск (дубль)');
        return null; // Duplicate
      }
      log.debug({
        platform: event.platform,
        eventId: event.eventId,
        peerId: event.peerId,
        kind: event.kind,
        text: event.text,
        action: event.action,
      }, 'входящее событие принято');
      return event;
    },

    /**
     * Process an accepted event through the flow.
     * Acquires per-conversation lock, checks state_version, routes to flow.
     * @param {object} event - InboundEvent
     * @param {object} adapter - platform adapter
     */
    async run(event, adapter) {
      const lockKey = `${event.platform}:${event.peerId}`;
      const startedAt = Date.now();
      const release = await locks.acquire(lockKey);

      try {
        const conversation = getConversation(event.platform, event.peerId);
        await rememberUser(conversation, event, adapter);

        // Check state_version for button actions (reject stale presses)
        if (event.kind === 'action' && event.action?.r !== conversation.stateVersion) {
          log.debug({
            platform: event.platform, peerId: event.peerId,
            pressed: event.action?.r, current: conversation.stateVersion,
          }, 'нажата устаревшая кнопка');
          await adapter.send(event.peerId, [{ text: texts.staleButton(), format: 'html' }], { event });
          return;
        }

        // Handle through flow
        const stateBefore = conversation.state;
        const replies = await flow.handle(conversation, event);

        // Index by documentId after flow mutates conversation
        indexByDocument(conversation);

        log.debug({
          platform: event.platform,
          peerId: event.peerId,
          state: stateBefore === conversation.state ? conversation.state : `${stateBefore} → ${conversation.state}`,
          documentId: conversation.documentId,
          pendingField: conversation.pendingField,
          replies: replies.length,
          ms: Date.now() - startedAt,
        }, 'диалог обработан');

        if (replies.length > 0) {
          await sendReplies({ adapter, flow, conversation, replies, event });
          log.debug({ platform: event.platform, peerId: event.peerId, replies: replies.length }, 'ответы отправлены');
        }

        markHandled.run(event.platform, event.eventId);
      } catch (err) {
        log.error({ event, error: err.message }, 'dispatcher run failed');
        markFailed.run(event.platform, event.eventId);
        try {
          await adapter.send(event.peerId, [{ text: '⚠️ Произошла ошибка. Повторите действие — введённый текст сохранён.', format: 'html' }], { event });
        } catch {}
      } finally {
        release();
      }
    },

    /**
     * Recover events stuck in 'received' (after server restart).
     * @param {Map} adapters - platform adapters
     */
    async recover(adapters) {
      const rows = getReceived.all();
      for (const row of rows) {
        try {
          const event = JSON.parse(row.payload);
          const adapter = adapters.get(event.platform);
          if (adapter) {
            await this.run(event, adapter);
          }
        } catch (err) {
          log.error({ error: err.message }, 'recover failed for event');
        }
      }
    },

    getConversation,
    findByDocumentId,
  };
}
