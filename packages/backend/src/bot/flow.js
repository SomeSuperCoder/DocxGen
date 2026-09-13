/**
 * Dialog flow handler — the core state machine for bot conversations.
 *
 * This is the heart of the dialog engine. It receives inbound events
 * and returns reply arrays. It does NOT send replies — that's the
 * dispatcher's job. It does NOT manage adapter-specific concerns —
 * that's the adapter's job.
 *
 * State machine:
 *   idle → collecting → choose_type → choose_template → processing
 *   processing → (ai_failed | confirm_warnings | asking_field | delivering)
 *   confirming_warnings → (asking_field | delivering | processing | editing)
 *   asking_field → (asking_field | delivering)
 *   delivering → ready
 *   delivery_failed → (ready | delivery_failed)
 *   ready → (choose_template | choose_type | editing)
 *   editing → delivering
 *
 * Every state transition increments stateVersion for stale-button detection.
 *
 * Dependencies are injected (Dependency Inversion):
 *   docServiceClient — document-service client for document lifecycle CRUD
 *   docTypes — document type catalog (list, get)
 *   templates — template catalog (list, get)
 *   log — pino-compatible logger
 */

import { mergeRequisites } from '../validation/requisites.js';
import * as keyboards from './keyboards.js';
import * as texts from './texts.js';

/**
 * Extract text string from texts.js function result.
 * Some functions return { text, buttons }, others return a plain string.
 * @param {string | { text: string }} result
 * @returns {string}
 */
function textOf(result) {
  return typeof result === 'string' ? result : result.text;
}

/**
 * Text reply in HTML (texts.js escapes every value).
 * @param {string | { text: string }} result - texts.js function result
 * @param {{ buttons?: Array, image?: { name: string } }} [extra]
 * @returns {{ text: string, format: 'html', buttons?: Array, image?: { name: string } }}
 */
function say(result, extra = {}) {
  return { text: textOf(result), format: 'html', ...extra };
}

/** Steps where a voice message becomes (part of) the draft. */
const VOICE_DRAFT_STATES = new Set(['idle', 'collecting']);

/**
 * How the draft can be sent on this platform. The MAX Bot API delivers a voice message without its
 * content (no chat, no attachment), so the MAX texts do not offer voice; VK delivers audio_message.
 * @param {{ platform?: string }} conversation
 * @returns {import('./texts.js').InputOptions}
 */
function inputOptions(conversation) {
  return { voice: conversation.platform !== 'max' };
}

/** Illustration shipped in assets/bot (see adapters/common/botImages.js). */
const image = (name) => ({ name });

/**
 * Create the dialog flow handler.
 *
 * Uses the injected document-service client for all document operations.
 *
 * @param {{ docServiceClient: object, docTypes: object, templates: object, log: object }} deps
 * @returns {{ handle: function, onDocumentEvent: function, onDeliveryFailed: function, setNotifier: function, trackProcessing: function }}
 */
export function createFlow({ docServiceClient, docTypes, templates, faultManager, debugCommands = false, log, transcribeAudio, miniAppUrl, miniAppBot }) {
  /**
   * Create an owner-bound client for a specific user.
   * Returns a client with owner headers attached.
   * @param {{ platform: string, id: string }} owner
   * @returns {object} client with methods: createDocument, getDocument, setDraft, etc.
   */
  function clientFor(owner) {
    return docServiceClient.withOwner(owner);
  }

  // Notifier reference — set after creation to avoid circular dependency
  let notifier = null;

  return {
    /**
     * Set the notifier for polling support. Called after creation to avoid circular deps.
     * @param {object} n — notifier instance with trackDocument method
     */
    setNotifier(n) {
      notifier = n;
    },

    /**
     * Track a document for polling when processing starts.
     *
     * Владелец передаётся вместе с идентификатором: сервис документов отдаёт
     * документ только его владельцу, и опрос без владельца всегда возвращал бы 404.
     * @param {string} documentId
     * @param {{ platform: string, id: string }} owner
     */
    trackProcessing(documentId, owner) {
      if (notifier) notifier.trackDocument(documentId, owner, 'processing');
    },
    /**
     * Handle an inbound event and return replies.
     * @param {object} conversation - current conversation state (mutated in place)
     * @param {object} event - InboundEvent
     * @returns {Promise<Array<{text, buttons?, format?, image?, file?}>>}
     */
    async handle(conversation, event) {
      // A voice message carries the platform attachment (a link) or an already downloaded buffer.
      // Its transcription is handled exactly like a typed draft, preserving the FSM and grounding;
      // the transcript is echoed first so the user sees what was recognized.
      // Only the draft is accepted by voice: the AI corrects it later. A requisite or the edited text
      // would reach the document as recognized — lowercase, without punctuation, numbers in words —
      // and on the other steps the text would be dropped, so Vosk is not called there at all.
      if (event.kind === 'audio') {
        if (conversation.state === 'processing') return [say(texts.busy())];
        if (!VOICE_DRAFT_STATES.has(conversation.state)) {
          const expectsText = conversation.state === 'asking_field' || conversation.state === 'editing';
          const buttons = this._currentKeyboard(conversation);
          return [say(texts.voiceOnlyForDraft(expectsText), buttons ? { buttons } : {})];
        }
        if (typeof transcribeAudio !== 'function' || !event.audio) {
          return [say(texts.audioUnavailable())];
        }
        let text;
        try {
          ({ text } = await transcribeAudio(event.audio, { platform: event.platform, ownerId: event.userId }));
        } catch (err) {
          log.warn({ error: err.message, code: err.code }, 'voice message not transcribed');
          return [say(texts.audioNotRecognized())];
        }
        if (!text) return [say(texts.audioNotRecognized())];
        const replies = await this.handle(conversation, { ...event, kind: 'text', text });
        return [say(texts.voiceRecognized(text)), ...replies];
      }
      // ── Global commands (work from any state) ─────────────────────────────

      // ── Commands ────────────────────────────────────────────────────
      if (event.kind === 'command') {
        if (event.command === 'help') {
          const buttons = this._currentKeyboard(conversation) || (conversation.platform === 'max' ? keyboards.miniAppKeyboard({ url: miniAppUrl, botUsername: miniAppBot }) : undefined);
          const options = inputOptions(conversation);
          if (conversation.platform === 'max' && miniAppUrl) options.miniAppUrl = miniAppUrl;
          return [say(texts.help(options), buttons ? { buttons } : {})];
        }
        // Scenario 6: simulate an AI outage for this user only (guarded by DEBUG_COMMANDS)
        if (event.command === 'ai_fail') {
          if (!debugCommands) return [say(texts.commandDisabled())];
          // Флаг взводится в сервисе документов — ИИ работает там, а не здесь
          await clientFor({ platform: event.platform, id: event.userId }).armAiFault();
          const buttons = this._currentKeyboard(conversation);
          return [say(texts.aiFaultArmed(), buttons ? { buttons } : {})];
        }
        if (event.command === 'new') return this._startDocument(conversation, event);
        if (event.command === 'documents') {
          const docs = await clientFor({ platform: event.platform, id: event.userId }).getDocuments({ limit: 10 });
          return [say(texts.myDocuments(docs.documents || []), { buttons: keyboards.mainKeyboard(conversation.stateVersion) })];
        }

        // /start — back to the welcome screen
        conversation.state = 'idle';
        conversation.stateVersion++;
        return [this._greeting(conversation)];
      }

      // "Начать" / "/start" typed as plain text
      if (event.kind === 'text' && /^(начать|\/start)$/i.test(event.text)) {
        conversation.state = 'idle';
        conversation.stateVersion++;
        return [this._greeting(conversation)];
      }

      if (event.kind === 'text' && /^(мои документы|\/documents)$/i.test(event.text)) {
        const docs = await clientFor({ platform: event.platform, id: event.userId }).getDocuments({ limit: 10 });
        return [say(texts.myDocuments(docs.documents || []), { buttons: keyboards.mainKeyboard(conversation.stateVersion) })];
      }

      if (event.kind === 'action' && event.action?.a === 'documents') {
        const docs = await clientFor({ platform: event.platform, id: event.userId }).getDocuments({ limit: 10 });
        return [say(texts.myDocuments(docs.documents || []), { buttons: keyboards.mainKeyboard(conversation.stateVersion) })];
      }

      // "Новый документ" from any state (typed or pressed)
      if ((event.kind === 'text' && /^(новый документ)$/i.test(event.text)) || (event.kind === 'action' && event.action?.a === 'new')) {
        return this._startDocument(conversation, event);
      }

      // ── State-based handling ──────────────────────────────────────────────
      switch (conversation.state) {
        case 'idle':
          return this._handleIdle(conversation, event);
        case 'collecting':
          return this._handleCollecting(conversation, event);
        case 'choose_type':
          return this._handleChooseType(conversation, event);
        case 'choose_template':
          return this._handleChooseTemplate(conversation, event);
        case 'processing':
          return [say(texts.busy())];
        case 'ai_failed':
          return this._handleAiFailed(conversation, event);
        case 'confirm_warnings':
          return this._handleConfirmWarnings(conversation, event);
        case 'asking_field':
          return this._handleAskingField(conversation, event);
        case 'delivering':
        case 'delivery_failed':
          return this._handleDelivering(conversation, event);
        case 'ready':
          return this._handleReady(conversation, event);
        case 'editing':
          return this._handleEditing(conversation, event);
        default:
          return [say(texts.unknownState(), { buttons: keyboards.mainKeyboard(conversation.stateVersion) })];
      }
    },

    // ── State handlers ────────────────────────────────────────────────────

    async _handleIdle(conversation, event) {
      if (event.kind === 'text') {
        // Start new document with this text as draft
        const owner = { platform: event.platform, id: event.userId };
        const doc = await clientFor(owner).createDocument({});
        conversation.documentId = doc.id;
        await clientFor(owner).setDraft(doc.id, event.text, { mode: 'replace' });
        conversation.state = 'collecting';
        conversation.stateVersion++;
        return [say(texts.collectDraftAccepted(event.text.length, inputOptions(conversation)), { buttons: keyboards.draftKeyboard(conversation.stateVersion) })];
      }
      return [say(texts.pressCreate(inputOptions(conversation)))];
    },

    async _handleCollecting(conversation, event) {
      const owner = { platform: event.platform, id: event.userId };

      if (event.kind === 'action') {
        if (event.action?.a === 'continue') {
          const doc = await clientFor(owner).getDocument(conversation.documentId);
          if (!doc.sourceText) {
            return [say(texts.draftEmpty(inputOptions(conversation)))];
          }
          conversation.state = 'choose_type';
          conversation.stateVersion++;
          return [this._chooseType(conversation)];
        }
        if (event.action?.a === 'show_draft') {
          const doc = await clientFor(owner).getDocument(conversation.documentId);
          // The keyboard is repeated: in MAX the pressed message loses its buttons and the user would be stuck
          return [say(texts.showDraft(doc.sourceText), { buttons: keyboards.draftKeyboard(conversation.stateVersion) })];
        }
        if (event.action?.a === 'replace_mode') {
          conversation.ctx = { ...conversation.ctx, inputMode: 'replace' };
          return [say(texts.replaceMode(inputOptions(conversation)))];
        }
      }

      if (event.kind === 'text') {
        const mode = conversation.ctx?.inputMode || 'append';
        await clientFor(owner).setDraft(conversation.documentId, event.text, { mode });
        // Reset to append after replace
        conversation.ctx = { ...conversation.ctx, inputMode: 'append' };
        const doc = await clientFor(owner).getDocument(conversation.documentId);
        return [say(texts.collectDraftAccepted(doc.sourceText.length, inputOptions(conversation)), { buttons: keyboards.draftKeyboard(conversation.stateVersion) })];
      }

      return [];
    },

    async _handleChooseType(conversation, event) {
      const owner = { platform: event.platform, id: event.userId };

      if (event.kind === 'action' && event.action?.a === 'set_type') {
        const typeId = event.action.v;
        await clientFor(owner).updateDocument(conversation.documentId, { docType: typeId });
        conversation.state = 'choose_template';
        conversation.stateVersion++;
        return [this._chooseTemplate(conversation)];
      }

      if (event.kind === 'text') {
        // Try to match by name or id
        const types = docTypes.list();
        const match = types.find(t =>
          t.name.toLowerCase() === event.text.toLowerCase() ||
          t.id === event.text.toLowerCase()
        );
        if (match) {
          await clientFor(owner).updateDocument(conversation.documentId, { docType: match.id });
          conversation.state = 'choose_template';
          conversation.stateVersion++;
          return [this._chooseTemplate(conversation)];
        }
        return [say(texts.unknownType(), { buttons: keyboards.typeKeyboard(types, conversation.stateVersion) })];
      }

      if (event.kind === 'action' && event.action?.a === 'back') {
        conversation.state = 'collecting';
        conversation.stateVersion++;
        return [say(texts.backToDraft(), { buttons: keyboards.draftKeyboard(conversation.stateVersion) })];
      }

      return [];
    },

    async _handleChooseTemplate(conversation, event) {
      const owner = { platform: event.platform, id: event.userId };

      if (event.kind === 'action' && event.action?.a === 'set_template') {
        const templateId = event.action.v;
        await clientFor(owner).updateDocument(conversation.documentId, { templateId: templateId });

        // Check if version is current (not stale)
        const doc = await clientFor(owner).getDocument(conversation.documentId);
        if (doc.version && !doc.version.stale) {
          // Version is current — render directly without reprocessing
          conversation.state = 'delivering';
          conversation.stateVersion++;
          return this._doRender(conversation, owner);
        }

        // Need to process with AI
        conversation.state = 'processing';
        conversation.stateVersion++;
        this.trackProcessing(conversation.documentId, owner);
        await clientFor(owner).processDocument(conversation.documentId);
        return [say(texts.processing())];
      }

      if (event.kind === 'action' && event.action?.a === 'back') {
        conversation.state = 'choose_type';
        conversation.stateVersion++;
        return [this._chooseType(conversation)];
      }

      return [];
    },

    async _handleAiFailed(conversation, event) {
      const owner = { platform: event.platform, id: event.userId };

      if (event.kind === 'action' && event.action?.a === 'retry') {
        this.trackProcessing(conversation.documentId, owner);
        await clientFor(owner).retryProcessing(conversation.documentId);
        conversation.state = 'processing';
        conversation.stateVersion++;
        return [say(texts.retrying())];
      }

      if (event.kind === 'action' && event.action?.a === 'show_draft') {
        const doc = await clientFor(owner).getDocument(conversation.documentId);
        return [say(texts.showDraft(doc.sourceText), { buttons: keyboards.retryKeyboard(conversation.stateVersion) })];
      }

      if (event.kind === 'action' && event.action?.a === 'new') {
        const doc = await clientFor(owner).createDocument({});
        conversation.documentId = doc.id;
        conversation.state = 'collecting';
        conversation.stateVersion++;
        // Без кнопок: под пустым черновиком «Готово» ведёт в тупик — кнопка появится после первого текста
        return [say(texts.newDocument(inputOptions(conversation)))];
      }

      return [];
    },

    async _handleConfirmWarnings(conversation, event) {
      const owner = { platform: event.platform, id: event.userId };

      if (event.kind === 'action' && event.action?.a === 'deliver') {
        // Check if there are pending fields before delivering
        const doc = await clientFor(owner).getDocument(conversation.documentId);
        const { pending } = mergeRequisites({
          docType: docTypes.get(doc.docType),
          template: templates.get(doc.templateId).template,
          aiFields: doc.version?.aiFields || {},
          title: doc.version?.title || null,
          userFields: doc.userFields,
          today: new Date().toISOString().slice(0, 10),
        });

        if (pending.length > 0) {
          conversation.state = 'asking_field';
          conversation.stateVersion++;
          const next = pending[0];
          conversation.pendingField = next.key;
          return [
            say(texts.result(doc.version?.changes || [])),
            say(texts.askField(next, pending.length), { buttons: keyboards.fieldKeyboard(conversation.stateVersion) }),
          ];
        }

        conversation.state = 'delivering';
        conversation.stateVersion++;
        return this._doRender(conversation, owner);
      }

      if (event.kind === 'action' && event.action?.a === 'retry') {
        conversation.state = 'processing';
        conversation.stateVersion++;
        this.trackProcessing(conversation.documentId, owner);
        await clientFor(owner).processDocument(conversation.documentId);
        return [say(texts.processing())];
      }

      if (event.kind === 'action' && event.action?.a === 'edit_text') {
        conversation.state = 'editing';
        conversation.stateVersion++;
        return [say(texts.editPrompt())];
      }

      return [];
    },

    async _handleAskingField(conversation, event) {
      const owner = { platform: event.platform, id: event.userId };

      if (event.kind === 'action' && event.action?.a === 'skip_field') {
        await clientFor(owner).setFields(conversation.documentId, { [conversation.pendingField]: null });
        return this._nextField(conversation, owner);
      }

      if (event.kind === 'action' && event.action?.a === 'skip_all') {
        // Skip all remaining fields — deliver as-is
        conversation.state = 'delivering';
        conversation.stateVersion++;
        return this._doRender(conversation, owner);
      }

      if (event.kind === 'text') {
        await clientFor(owner).setFields(conversation.documentId, { [conversation.pendingField]: event.text });
        return this._nextField(conversation, owner);
      }

      return [];
    },

    _handleDelivering(conversation, event) {
      // "Отправить ещё раз" — the same file, without AI and without re-rendering
      if (event.kind === 'action' && event.action?.a === 'resend' && conversation.lastFileId) {
        conversation.state = 'ready';
        conversation.stateVersion++;
        return [
          say(texts.resending(), { buttons: keyboards.resultKeyboard(conversation.stateVersion) }),
          { file: { fileId: conversation.lastFileId, caption: 'Документ' } },
        ];
      }
      // Otherwise the user is simply waiting for the async render
      return [];
    },

    async _handleReady(conversation, event) {
      const owner = { platform: event.platform, id: event.userId };

      if (event.kind === 'action' && event.action?.a === 'other_template') {
        conversation.state = 'choose_template';
        conversation.stateVersion++;
        return [this._chooseTemplate(conversation)];
      }

      if (event.kind === 'action' && event.action?.a === 'other_type') {
        conversation.state = 'choose_type';
        conversation.stateVersion++;
        return [this._chooseType(conversation)];
      }

      if (event.kind === 'action' && event.action?.a === 'edit_text') {
        conversation.state = 'editing';
        conversation.stateVersion++;
        return [say(texts.editPrompt())];
      }

      if (event.kind === 'action' && event.action?.a === 'show_draft') {
        const doc = await clientFor(owner).getDocument(conversation.documentId);
        if (doc.version) {
          const text = [doc.version.title, ...doc.version.body].filter(Boolean).join('\n\n');
          return [say(texts.showResult(text), { buttons: keyboards.resultKeyboard(conversation.stateVersion) })];
        }
      }

      return [];
    },

    async _handleEditing(conversation, event) {
      const owner = { platform: event.platform, id: event.userId };

      if (event.kind === 'text') {
        const lines = event.text.split('\n\n').filter(l => l.trim());
        let title = null;
        let body = lines;
        if (lines[0]?.toLowerCase().startsWith('о ')) {
          title = lines[0];
          body = lines.slice(1);
        }
        await clientFor(owner).setManualText(conversation.documentId, { title, body });
        conversation.state = 'delivering';
        conversation.stateVersion++;
        return this._doRender(conversation, owner);
      }

      return [];
    },

    // ── Internal helpers ──────────────────────────────────────────────

    /**
     * Create a new document and switch to draft collection.
     * @param {object} conversation
     * @param {object} event - InboundEvent (carries platform and userId)
     * @returns {Array}
     */
    async _startDocument(conversation, event) {
      const doc = await clientFor({ platform: event.platform, id: event.userId }).createDocument({});
      conversation.documentId = doc.id;
      conversation.lastFileId = null;
      conversation.pendingField = null;
      conversation.state = 'collecting';
      conversation.stateVersion++;
      // Без кнопок: под пустым черновиком «Готово» ведёт в тупик — кнопка появится после первого текста
      return [say(texts.collectDraftStart(inputOptions(conversation)))];
    },

    /** Welcome screen with the «Документ за 3 шага» banner. */
    _greeting(conversation) {
      const buttons = conversation.platform === 'max' ? keyboards.miniAppKeyboard({ url: miniAppUrl, botUsername: miniAppBot }) : undefined;
      return say(texts.greeting(conversation.profile, inputOptions(conversation)), { image: image('greeting'), ...(buttons ? { buttons } : {}) });
    },

    /** Document type choice with the card of all types. */
    _chooseType(conversation) {
      const types = docTypes.list();
      return say(texts.chooseType(types), { buttons: keyboards.typeKeyboard(types, conversation.stateVersion), image: image('types') });
    },

    /** Template choice with the side-by-side template sketch. */
    _chooseTemplate(conversation) {
      const tmplList = templates.list();
      return say(texts.chooseTemplate(tmplList), { buttons: keyboards.templateKeyboard(tmplList, conversation.stateVersion), image: image('templates') });
    },

    /**
     * Keyboard of the current step for replies outside the flow (a stale button in the dispatcher).
     * @param {object} conversation
     * @returns {Array|undefined}
     */
    currentKeyboard(conversation) {
      return this._currentKeyboard(conversation);
    },

    /**
     * Keyboard of the current step — appended to informational replies (/help, /ai_fail)
     * so the user always has something to press.
     * @param {object} conversation
     * @returns {Array|undefined}
     */
    _currentKeyboard(conversation) {
      switch (conversation.state) {
        case 'collecting': return keyboards.draftKeyboard(conversation.stateVersion);
        case 'choose_type': return keyboards.typeKeyboard(docTypes.list(), conversation.stateVersion);
        case 'choose_template': return keyboards.templateKeyboard(templates.list(), conversation.stateVersion);
        case 'asking_field': return keyboards.fieldKeyboard(conversation.stateVersion);
        case 'confirm_warnings': return keyboards.warningKeyboard(conversation.stateVersion);
        case 'ai_failed': return keyboards.retryKeyboard(conversation.stateVersion);
        case 'delivery_failed': return keyboards.resendKeyboard(conversation.stateVersion);
        case 'ready': return keyboards.resultKeyboard(conversation.stateVersion);
        default: return undefined;
      }
    },

    /**
     * Render document and return file reply.
     * Called when state transitions to delivering.
     * @param {object} conversation
     * @param {{ platform: string, id: string }} owner
     * @returns {Promise<Array>}
     */
    async _doRender(conversation, owner) {
      try {
        // Render result format differs by mode:
        // REST API: { fileId, filename, downloadUrl, placeholders, fallback }
        // Direct service: { file: { id, filename }, fallback, placeholders }
        const result = await clientFor(owner).renderDocument(conversation.documentId);
        const fileId = result.fileId || result.file?.id;
        const filename = result.filename || result.file?.filename;
        const fallbackId = result.fallback;
        const placeholders = result.placeholders || [];

        conversation.lastFileId = fileId; // for "Отправить ещё раз"
        conversation.state = 'ready';
        conversation.stateVersion++;
        const doc = await clientFor(owner).getDocument(conversation.documentId);
        const docType = docTypes.get(doc.docType);
        const { template } = templates.get(doc.templateId);
        const fallback = fallbackId ? { requestedId: fallbackId, reason: 'missing_or_invalid' } : null;
        return [
          say(texts.ready(docType?.name || doc.docType, template?.name || doc.templateId, placeholders, fallback), {
            buttons: keyboards.resultKeyboard(conversation.stateVersion),
            image: image('ready'),
          }),
          { file: { fileId, caption: filename } },
        ];
      } catch (err) {
        log.error({ error: err.message }, 'render failed');
        conversation.state = 'delivery_failed';
        conversation.stateVersion++;
        return [say(texts.deliveryError(), { buttons: keyboards.resendKeyboard(conversation.stateVersion) })];
      }
    },

    /**
     * Move to next pending field or deliver.
     * @param {object} conversation
     * @param {{ platform: string, id: string }} owner
     * @returns {Promise<Array>}
     */
    async _nextField(conversation, owner) {
      const doc = await clientFor(owner).getDocument(conversation.documentId);
      const { pending } = mergeRequisites({
        docType: docTypes.get(doc.docType),
        template: templates.get(doc.templateId).template,
        aiFields: doc.version?.aiFields || {},
        title: doc.version?.title || null,
        userFields: doc.userFields,
        today: new Date().toISOString().slice(0, 10),
      });

      if (pending.length === 0) {
        conversation.state = 'delivering';
        conversation.stateVersion++;
        return this._doRender(conversation, owner);
      }

      const next = pending[0];
      conversation.pendingField = next.key;
      conversation.pendingQueue = pending.slice(1);
      return [say(texts.askField(next, pending.length), { buttons: keyboards.fieldKeyboard(conversation.stateVersion) })];
    },

    // ── External event handlers (called by notifier/dispatcher) ───────────

    /**
     * Handle document processed/failed event — called by notifier.
     * @param {object} conversation
     * @param {{ type: 'processed'|'failed', documentId: string }} event
     * @returns {Promise<Array>}
     */
    async onDocumentEvent(conversation, event) {
      // Owner is the user, not the chat: in MAX the chat id and the user id are different numbers.
      const owner = { platform: conversation.platform, id: conversation.userId ?? conversation.peerId };

      if (event.type === 'processed') {
        const doc = await clientFor(owner).getDocument(conversation.documentId);
        const { pending } = mergeRequisites({
          docType: docTypes.get(doc.docType),
          template: templates.get(doc.templateId).template,
          aiFields: doc.version?.aiFields || {},
          title: doc.version?.title || null,
          userFields: doc.userFields,
          today: new Date().toISOString().slice(0, 10),
        });

        const replies = [say(texts.result(doc.version?.changes || []))];

        // Check for warnings (AI added facts not in draft)
        const warnings = doc.version?.warnings || {};
        if (warnings.added?.length > 0) {
          replies[0].text += '\n\n' + texts.factWarnings(warnings);
          conversation.state = 'confirm_warnings';
          conversation.stateVersion++;
          replies[0].buttons = keyboards.warningKeyboard(conversation.stateVersion);
          return replies;
        }

        if (pending.length > 0) {
          conversation.state = 'asking_field';
          conversation.stateVersion++;
          const next = pending[0];
          conversation.pendingField = next.key;
          replies.push(say(texts.askField(next, pending.length), { buttons: keyboards.fieldKeyboard(conversation.stateVersion) }));
          return replies;
        }

        // Ready to deliver
        conversation.state = 'delivering';
        conversation.stateVersion++;
        return this._doRender(conversation, owner);
      }

      if (event.type === 'failed') {
        const doc = await clientFor(owner).getDocument(conversation.documentId);
        const charCount = doc?.sourceText?.length || 0;
        conversation.state = 'ai_failed';
        conversation.stateVersion++;
        return [say(texts.aiError(charCount), { buttons: keyboards.retryKeyboard(conversation.stateVersion), image: image('ai-error') })];
      }

      return [];
    },

    /**
     * Handle delivery failed — called by dispatcher.
     * @param {object} conversation
     * @param {string} fileId
     * @returns {Array}
     */
    onDeliveryFailed(conversation, fileId) {
      conversation.state = 'delivery_failed';
      conversation.lastFileId = fileId;
      conversation.stateVersion++;
      return [say(texts.deliveryError(), { buttons: keyboards.resendKeyboard(conversation.stateVersion) })];
    },
  };
}
