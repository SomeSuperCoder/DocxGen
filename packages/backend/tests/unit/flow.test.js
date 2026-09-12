/**
 * Unit tests for the dialog flow handler (state machine).
 *
 * Uses mock docServiceClient (REST), docTypes, and templates — no real DB, no real AI.
 * Tests cover the full dialog path, state transitions, button actions, and
 * edge cases specified in plan-backend.md §11.1.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFlow } from '../../src/bot/flow.js';
import { encode } from '../../src/bot/payload.js';

// ── Mock data ────────────────────────────────────────────────────────────

const mockDocTypes = [
  { id: 'memo', name: 'Служебная записка', hint: 'Для внутренних обращений', fields: [
    { key: 'Адресат', label: 'Адресат', kind: 'extract', required: true, question: 'Кому адресовано?', example: 'Директору Иванову И.И.' },
    { key: 'Должность автора', label: 'Должность автора', kind: 'extract', required: true, question: 'Какая ваша должность?', example: 'Начальник отдела' },
    { key: 'ФИО автора', label: 'ФИО автора', kind: 'extract', required: true, question: 'Ваши ФИО?', example: 'Петров П.П.' },
  ]},
  { id: 'report', name: 'Докладная записка', hint: 'Для докладов руководству', fields: [
    { key: 'Адресат', label: 'Адресат', kind: 'extract', required: true, question: 'Кому адресовано?', example: 'Директору' },
  ]},
];

const mockTemplates = [
  { id: 'classic', name: 'Классический', description: 'Стандартное оформление', organization: { name: 'ООО Рога и Копыта' }, autoFill: { date: true }, dateFormat: 'DD.MM.YYYY' },
  { id: 'modern', name: 'Современный', description: 'С включённым стилем', organization: { name: 'ООО Рога и Копыта' }, autoFill: { date: true }, dateFormat: 'DD.MM.YYYY' },
];

function mockDocTypesService() {
  return {
    list: () => mockDocTypes,
    get: (id) => mockDocTypes.find(t => t.id === id) || null,
  };
}

function mockTemplatesService() {
  return {
    list: () => mockTemplates,
    get: (id) => {
      const t = mockTemplates.find(t => t.id === id);
      return t ? { template: t, fallback: null } : { template: mockTemplates[0], fallback: { requestedId: id, reason: 'missing' } };
    },
  };
}

function mockDocServiceClient() {
  let docCounter = 0;
  const docs = new Map();

  return {
    withOwner: vi.fn((owner) => ({
      createDocument: vi.fn(() => {
        const id = `doc-${++docCounter}`;
        docs.set(id, {
          id, owner_platform: owner.platform, owner_id: owner.id,
          status: 'draft', doc_type: null, template_id: null,
          source_text: '', draft_version: 0, user_fields: '{}',
          current_version_id: null, last_error: null,
        });
        return { id, status: 'draft', docType: null, templateId: null, sourceText: '', draftVersion: 0, userFields: {}, version: null, error: null };
      }),
      getDocument: vi.fn((id) => {
        const doc = docs.get(id);
        if (!doc) return null;
        const uf = JSON.parse(doc.user_fields || '{}');
        let version = null;
        if (doc.current_version_id) {
          const parsed = JSON.parse(doc.current_version_id);
          version = { ...parsed, stale: parsed.draftVersion !== doc.draft_version };
        }
        return {
          id: doc.id, status: doc.status, docType: doc.doc_type, templateId: doc.template_id,
          sourceText: doc.source_text, draftVersion: doc.draft_version, userFields: uf,
          version,
          error: doc.last_error,
        };
      }),
      setDraft: vi.fn((id, text, { mode } = {}) => {
        const doc = docs.get(id);
        if (mode === 'replace') {
          doc.source_text = text;
        } else {
          doc.source_text = doc.source_text ? doc.source_text + '\n' + text : text;
        }
        doc.draft_version++;
        return docs.get(id);
      }),
      updateDocument: vi.fn((id, data) => {
        const doc = docs.get(id);
        if (data.docType !== undefined) doc.doc_type = data.docType;
        if (data.templateId !== undefined) doc.template_id = data.templateId;
        return doc;
      }),
      processDocument: vi.fn((id) => {
        const doc = docs.get(id);
        doc.status = 'processing';
        return { job: { id: 'job-1' }, reused: false };
      }),
      retryProcessing: vi.fn((id) => {
        const doc = docs.get(id);
        doc.status = 'processing';
        return { job: { id: 'job-2' }, reused: false };
      }),
      renderDocument: vi.fn(async (id) => {
        return {
          fileId: 'file-1',
          filename: 'test.docx',
          fallback: null,
          placeholders: [],
        };
      }),
      setFields: vi.fn((id, fields) => {
        const doc = docs.get(id);
        for (const [key, value] of Object.entries(fields)) {
          const uf = JSON.parse(doc.user_fields || '{}');
          uf[key] = value;
          doc.user_fields = JSON.stringify(uf);
        }
        return doc;
      }),
      setManualText: vi.fn((id, { title, body }) => {
        const doc = docs.get(id);
        doc.status = 'processed';
        doc.current_version_id = JSON.stringify({ kind: 'manual', title, body: JSON.stringify(body), aiFields: {}, changes: [], warnings: [], stale: false });
        return doc;
      }),
    })),
    _docs: docs,
  };
}

const mockLog = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

// ── Helpers ──────────────────────────────────────────────────────────────

function makeEvent(overrides = {}) {
  return {
    platform: 'max',
    userId: 'user-1',
    peerId: 'peer-1',
    eventId: `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    kind: 'text',
    text: '',
    ...overrides,
  };
}

function actionEvent(action, overrides = {}) {
  return makeEvent({ kind: 'action', action, ...overrides });
}

function commandEvent(cmd = 'start') {
  return makeEvent({ kind: 'command', command: cmd });
}

function makeConversation(overrides = {}) {
  return {
    platform: 'max',
    peerId: 'peer-1',
    state: 'idle',
    stateVersion: 0,
    documentId: null,
    pendingField: null,
    pendingQueue: [],
    ctx: {},
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('flow', () => {
  let flow;
  let client;
  let docs;

  beforeEach(() => {
    client = mockDocServiceClient();
    docs = client._docs;
    flow = createFlow({
      docServiceClient: client,
      docTypes: mockDocTypesService(),
      templates: mockTemplatesService(),
      log: mockLog,
    });
  });

  // ── 1. Full path: idle → collecting → choose_type → choose_template → processing → ready

  it('full path: idle → collecting → choose_type → choose_template → processing → ready', async () => {
    const conv = makeConversation();

    // Start from idle with /start
    const r1 = await flow.handle(conv, commandEvent('start'));
    expect(r1[0].text).toContain('Здравствуйте');
    expect(r1[0].buttons).toBeDefined();

    // User sends text → creates doc, moves to collecting
    const r2 = await flow.handle(conv, makeEvent({ text: 'Текст черновика' }));
    expect(conv.state).toBe('collecting');
    expect(conv.documentId).toBeTruthy();
    expect(client.withOwner).toHaveBeenCalled();

    // Click "Продолжить" → choose_type
    const r3 = await flow.handle(conv, actionEvent({ a: 'continue', r: conv.stateVersion }));
    expect(conv.state).toBe('choose_type');
    expect(r3[0].buttons).toBeDefined();

    // Select type → choose_template
    const r4 = await flow.handle(conv, actionEvent({ a: 'set_type', v: 'memo', r: conv.stateVersion }));
    expect(conv.state).toBe('choose_template');

    // Select template → processing
    const r5 = await flow.handle(conv, actionEvent({ a: 'set_template', v: 'classic', r: conv.stateVersion }));
    expect(conv.state).toBe('processing');
    expect(r5[0].text).toContain('Исправляю текст');
  });

  // ── 2. Two text messages appended in collecting

  it('two text messages appended in collecting', async () => {
    docs.set('doc-1', {
      id: 'doc-1', owner_platform: 'max', owner_id: 'user-1',
      status: 'draft', doc_type: null, template_id: null,
      source_text: '', draft_version: 0, user_fields: '{}',
      current_version_id: null, last_error: null,
    });

    const conv = makeConversation({ state: 'collecting', documentId: 'doc-1' });

    await flow.handle(conv, makeEvent({ text: 'Первая часть' }));
    await flow.handle(conv, makeEvent({ text: 'Вторая часть' }));
    // Both calls should have used withOwner
    expect(client.withOwner).toHaveBeenCalled();
  });

  // ── 3. "Назад" at each step

  it('"Назад" from choose_type returns to collecting', async () => {
    const conv = makeConversation({ state: 'choose_type', documentId: 'doc-1', stateVersion: 2 });
    const r = await flow.handle(conv, actionEvent({ a: 'back', r: conv.stateVersion }));
    expect(conv.state).toBe('collecting');
    expect(r[0].buttons).toBeDefined();
  });

  it('"Назад" from choose_template returns to choose_type', async () => {
    const conv = makeConversation({ state: 'choose_template', documentId: 'doc-1', stateVersion: 3 });
    const r = await flow.handle(conv, actionEvent({ a: 'back', r: conv.stateVersion }));
    expect(conv.state).toBe('choose_type');
    expect(r[0].buttons).toBeDefined();
  });

  // ── 4. Stale button (wrong state_version) → handled by dispatcher, not flow

  it('flow processes action regardless of stateVersion (stale check is in dispatcher)', async () => {
    docs.set('doc-1', {
      id: 'doc-1', owner_platform: 'max', owner_id: 'user-1',
      status: 'draft', doc_type: null, template_id: null,
      source_text: 'Some text', draft_version: 1, user_fields: '{}',
      current_version_id: null, last_error: null,
    });
    const conv = makeConversation({ state: 'collecting', documentId: 'doc-1', stateVersion: 5 });
    const r = await flow.handle(conv, actionEvent({ a: 'continue', r: 3 }));
    expect(conv.state).toBe('choose_type');
  });

  // ── 5. Input during processing → "wait" message

  it('input during processing returns busy message', async () => {
    const conv = makeConversation({ state: 'processing' });
    const r = await flow.handle(conv, makeEvent({ text: 'Привет' }));
    expect(r[0].text).toContain('Обработка ещё идёт');
  });

  // ── 6. AI failure → retry → new job

  it('AI failure → retry triggers retryProcessing', async () => {
    docs.set('doc-1', {
      id: 'doc-1', owner_platform: 'max', owner_id: 'user-1',
      status: 'ai_failed', doc_type: 'memo', template_id: 'classic',
      source_text: 'Текст', draft_version: 1, user_fields: '{}',
      current_version_id: null, last_error: 'AI error',
    });

    const conv = makeConversation({ state: 'ai_failed', documentId: 'doc-1', stateVersion: 3 });

    const r = await flow.handle(conv, actionEvent({ a: 'retry', r: conv.stateVersion }));
    expect(conv.state).toBe('processing');
  });

  // ── 7. "Другой шаблон" doesn't trigger startProcessing

  it('"Другой шаблон" from ready goes to choose_template without processing', async () => {
    docs.set('doc-1', {
      id: 'doc-1', owner_platform: 'max', owner_id: 'user-1',
      status: 'processed', doc_type: 'memo', template_id: 'classic',
      source_text: 'Текст', draft_version: 1, user_fields: '{}',
      current_version_id: '{"kind":"ai","title":null,"body":[],"aiFields":{},"changes":[],"warnings":[],"stale":false}',
      last_error: null,
    });

    const conv = makeConversation({ state: 'ready', documentId: 'doc-1', stateVersion: 5 });
    const r = await flow.handle(conv, actionEvent({ a: 'other_template', r: conv.stateVersion }));
    expect(conv.state).toBe('choose_template');
    expect(r[0].buttons).toBeDefined();
  });

  // ── 8. "Другой тип" triggers re-processing

  it('"Другой тип" from ready goes to choose_type', async () => {
    docs.set('doc-1', {
      id: 'doc-1', owner_platform: 'max', owner_id: 'user-1',
      status: 'processed', doc_type: 'memo', template_id: 'classic',
      source_text: 'Текст', draft_version: 1, user_fields: '{}',
      current_version_id: '{"kind":"ai","title":null,"body":[],"aiFields":{},"changes":[],"warnings":[],"stale":false}',
      last_error: null,
    });

    const conv = makeConversation({ state: 'ready', documentId: 'doc-1', stateVersion: 5 });
    const r = await flow.handle(conv, actionEvent({ a: 'other_type', r: conv.stateVersion }));
    expect(conv.state).toBe('choose_type');
    expect(r[0].buttons).toBeDefined();
  });

  // ── 9. "Оставить незаполненным" → setFields(key, null)

  it('"Оставить незаполненным" sets field to null', async () => {
    docs.set('doc-1', {
      id: 'doc-1', owner_platform: 'max', owner_id: 'user-1',
      status: 'processed', doc_type: 'report', template_id: 'classic',
      source_text: 'Текст', draft_version: 1, user_fields: '{}',
      current_version_id: null, last_error: null,
    });

    const conv = makeConversation({
      state: 'asking_field', documentId: 'doc-1', stateVersion: 4,
      pendingField: 'Адресат',
    });

    // Create a fresh client that returns a doc with no pending fields
    const freshClient = mockDocServiceClient();
    freshClient.withOwner = vi.fn(() => ({
      createDocument: vi.fn(),
      getDocument: vi.fn(() => ({
        id: 'doc-1', status: 'processed', docType: 'report', templateId: 'classic',
        sourceText: 'Текст', draftVersion: 1, userFields: { 'Адресат': null },
        version: { aiFields: {}, title: null, stale: false },
      })),
      setDraft: vi.fn(),
      updateDocument: vi.fn(),
      processDocument: vi.fn(),
      retryProcessing: vi.fn(),
      renderDocument: vi.fn(async () => ({ fileId: 'file-1', filename: 'test.docx', fallback: null, placeholders: [] })),
      setFields: vi.fn(),
      setManualText: vi.fn(),
    }));

    const freshFlow = createFlow({
      docServiceClient: freshClient,
      docTypes: mockDocTypesService(),
      templates: mockTemplatesService(),
      log: mockLog,
    });

    await freshFlow.handle(conv, actionEvent({ a: 'skip_field', r: conv.stateVersion }));
    expect(conv.state).toBe('ready');
  });

  // ── 10. "Показать черновик" → shows text

  it('"Показать черновик" shows draft text', async () => {
    docs.set('doc-1', {
      id: 'doc-1', owner_platform: 'max', owner_id: 'user-1',
      status: 'draft', doc_type: null, template_id: null,
      source_text: 'Это черновик документа', draft_version: 1, user_fields: '{}',
      current_version_id: null, last_error: null,
    });

    const conv = makeConversation({ state: 'collecting', documentId: 'doc-1', stateVersion: 1 });
    const r = await flow.handle(conv, actionEvent({ a: 'show_draft', r: conv.stateVersion }));
    expect(r[0].text).toContain('Черновик');
    expect(r[0].text).toContain('Это черновик документа');
  });

  // ── 11. "Заменить текст" → next message replaces

  it('"Заменить текст" then next message uses replace mode', async () => {
    docs.set('doc-1', {
      id: 'doc-1', owner_platform: 'max', owner_id: 'user-1',
      status: 'draft', doc_type: null, template_id: null,
      source_text: 'Старый текст', draft_version: 1, user_fields: '{}',
      current_version_id: null, last_error: null,
    });

    const conv = makeConversation({ state: 'collecting', documentId: 'doc-1', stateVersion: 1 });

    // Click "Заменить текст"
    await flow.handle(conv, actionEvent({ a: 'replace_mode', r: conv.stateVersion }));
    expect(conv.ctx.inputMode).toBe('replace');

    // Send new text
    await flow.handle(conv, makeEvent({ text: 'Новый текст' }));
    // Should reset to append after replace
    expect(conv.ctx.inputMode).toBe('append');
  });

  // ── Additional tests

  it('idle + text creates document and moves to collecting', async () => {
    const conv = makeConversation();
    const r = await flow.handle(conv, makeEvent({ text: 'Мой черновик' }));
    expect(conv.state).toBe('collecting');
    expect(conv.documentId).toBeTruthy();
    expect(r[0].text).toContain('Принято');
  });

  it('collecting + continue with empty draft returns error', async () => {
    docs.set('doc-1', {
      id: 'doc-1', owner_platform: 'max', owner_id: 'user-1',
      status: 'draft', doc_type: null, template_id: null,
      source_text: '', draft_version: 0, user_fields: '{}',
      current_version_id: null, last_error: null,
    });

    const conv = makeConversation({ state: 'collecting', documentId: 'doc-1' });
    const r = await flow.handle(conv, actionEvent({ a: 'continue', r: conv.stateVersion }));
    expect(r[0].text).toContain('Черновик пуст');
    expect(conv.state).toBe('collecting');
  });

  it('choose_type text match by name', async () => {
    docs.set('doc-1', {
      id: 'doc-1', owner_platform: 'max', owner_id: 'user-1',
      status: 'draft', doc_type: null, template_id: null,
      source_text: 'Текст', draft_version: 1, user_fields: '{}',
      current_version_id: null, last_error: null,
    });

    const conv = makeConversation({ state: 'choose_type', documentId: 'doc-1', stateVersion: 2 });
    const r = await flow.handle(conv, makeEvent({ text: 'Служебная записка' }));
    expect(conv.state).toBe('choose_template');
  });

  it('choose_type unrecognized text returns error with keyboard', async () => {
    docs.set('doc-1', {
      id: 'doc-1', owner_platform: 'max', owner_id: 'user-1',
      status: 'draft', doc_type: null, template_id: null,
      source_text: 'Текст', draft_version: 1, user_fields: '{}',
      current_version_id: null, last_error: null,
    });

    const conv = makeConversation({ state: 'choose_type', documentId: 'doc-1', stateVersion: 2 });
    const r = await flow.handle(conv, makeEvent({ text: 'Что-то непонятное' }));
    expect(r[0].text).toContain('Не понял тип');
    expect(r[0].buttons).toBeDefined();
    expect(conv.state).toBe('choose_type');
  });

  it('choose_template with stale version triggers processing', async () => {
    docs.set('doc-1', {
      id: 'doc-1', owner_platform: 'max', owner_id: 'user-1',
      status: 'draft', doc_type: 'memo', template_id: null,
      source_text: 'Текст', draft_version: 2, user_fields: '{}',
      current_version_id: '{"kind":"ai","draftVersion":1}', last_error: null,
    });

    const conv = makeConversation({ state: 'choose_template', documentId: 'doc-1', stateVersion: 3 });
    const r = await flow.handle(conv, actionEvent({ a: 'set_template', v: 'classic', r: conv.stateVersion }));
    expect(conv.state).toBe('processing');
  });

  it('ready + show_draft shows version body', async () => {
    docs.set('doc-1', {
      id: 'doc-1', owner_platform: 'max', owner_id: 'user-1',
      status: 'processed', doc_type: 'memo', template_id: 'classic',
      source_text: 'Текст', draft_version: 1, user_fields: '{}',
      current_version_id: '{"kind":"ai","title":"О тесте","body":["Абзац 1","Абзац 2"],"aiFields":{},"changes":[],"warnings":[],"stale":false}',
      last_error: null,
    });

    const conv = makeConversation({ state: 'ready', documentId: 'doc-1', stateVersion: 5 });
    const r = await flow.handle(conv, actionEvent({ a: 'show_draft', r: conv.stateVersion }));
    expect(r[0].text).toContain('Исправленный текст');
    expect(r[0].text).toContain('Абзац 1');
  });

  it('ready + edit_text moves to editing', async () => {
    const conv = makeConversation({ state: 'ready', documentId: 'doc-1', stateVersion: 5 });
    const r = await flow.handle(conv, actionEvent({ a: 'edit_text', r: conv.stateVersion }));
    expect(conv.state).toBe('editing');
    expect(r[0].text).toContain('Отправьте исправленный текст');
  });

  it('editing + text parses title and body, transitions to ready via _doRender', async () => {
    docs.set('doc-1', {
      id: 'doc-1', owner_platform: 'max', owner_id: 'user-1',
      status: 'processed', doc_type: 'memo', template_id: 'classic',
      source_text: 'Текст', draft_version: 1, user_fields: '{}',
      current_version_id: null, last_error: null,
    });

    const conv = makeConversation({ state: 'editing', documentId: 'doc-1', stateVersion: 6 });
    const r = await flow.handle(conv, makeEvent({ text: 'О важном\n\nПараграф первый.\n\nПараграф второй.' }));
    // _doRender is async and sets state to 'ready' after successful render
    expect(conv.state).toBe('ready');
  });

  it('global "Новый документ" from any state resets to collecting', async () => {
    docs.set('doc-old', {
      id: 'doc-old', owner_platform: 'max', owner_id: 'user-1',
      status: 'processed', doc_type: 'memo', template_id: 'classic',
      source_text: 'Текст', draft_version: 1, user_fields: '{}',
      current_version_id: '{"kind":"ai","title":null,"body":[],"aiFields":{},"changes":[],"warnings":[],"stale":false}',
      last_error: null,
    });

    const conv = makeConversation({ state: 'choose_template', documentId: 'doc-old', stateVersion: 3 });
    const r = await flow.handle(conv, makeEvent({ text: 'Новый документ' }));
    expect(conv.state).toBe('collecting');
    // New doc should have been created with a new ID
    expect(conv.documentId).toBeTruthy();
    expect(r[0].buttons).toBeDefined();
  });

  it('unknown state returns error with main keyboard', async () => {
    const conv = makeConversation({ state: 'unknown_state' });
    const r = await flow.handle(conv, makeEvent({ text: 'test' }));
    expect(r[0].text).toContain('Неизвестное состояние');
    expect(r[0].buttons).toBeDefined();
  });

  it('confirm_warnings + deliver with pending fields goes to asking_field', async () => {
    docs.set('doc-1', {
      id: 'doc-1', owner_platform: 'max', owner_id: 'user-1',
      status: 'processed', doc_type: 'memo', template_id: 'classic',
      source_text: 'Текст', draft_version: 1, user_fields: '{}',
      current_version_id: '{"kind":"ai","title":null,"body":[],"aiFields":{},"changes":["Исправлена орфография"],"warnings":{"added":["факт"]},"stale":false}',
      last_error: null,
    });

    const conv = makeConversation({ state: 'confirm_warnings', documentId: 'doc-1', stateVersion: 4 });
    const r = await flow.handle(conv, actionEvent({ a: 'deliver', r: conv.stateVersion }));
    // Should go to asking_field because memo has required fields without values
    expect(conv.state).toBe('asking_field');
    expect(conv.pendingField).toBeTruthy();
  });

  it('confirm_warnings + retry goes to processing', async () => {
    docs.set('doc-1', {
      id: 'doc-1', owner_platform: 'max', owner_id: 'user-1',
      status: 'processed', doc_type: 'memo', template_id: 'classic',
      source_text: 'Текст', draft_version: 1, user_fields: '{}',
      current_version_id: '{"kind":"ai","title":null,"body":[],"aiFields":{},"changes":[],"warnings":{"added":["факт"]},"stale":false}',
      last_error: null,
    });

    const conv = makeConversation({ state: 'confirm_warnings', documentId: 'doc-1', stateVersion: 4 });
    await flow.handle(conv, actionEvent({ a: 'retry', r: conv.stateVersion }));
    expect(conv.state).toBe('processing');
  });

  it('confirm_warnings + edit_text goes to editing', async () => {
    const conv = makeConversation({ state: 'confirm_warnings', documentId: 'doc-1', stateVersion: 4 });
    const r = await flow.handle(conv, actionEvent({ a: 'edit_text', r: conv.stateVersion }));
    expect(conv.state).toBe('editing');
    expect(r[0].text).toContain('Отправьте исправленный текст');
  });

  // ── Оформление: HTML-разметка и иллюстрации ─────────────────────────────

  it('illustrates greeting, type and template choice, ready and AI failure', async () => {
    const conv = makeConversation();

    const greeting = await flow.handle(conv, commandEvent('start'));
    expect(greeting[0].image).toEqual({ name: 'greeting' });

    await flow.handle(conv, makeEvent({ text: 'Текст черновика' }));
    const types = await flow.handle(conv, actionEvent({ a: 'continue', r: conv.stateVersion }));
    expect(types[0].image).toEqual({ name: 'types' });

    const tmpl = await flow.handle(conv, actionEvent({ a: 'set_type', v: 'memo', r: conv.stateVersion }));
    expect(tmpl[0].image).toEqual({ name: 'templates' });

    const failed = await flow.onDocumentEvent(
      { ...conv, userId: 'user-1', state: 'processing' },
      { type: 'failed', documentId: conv.documentId },
    );
    expect(failed[0].image).toEqual({ name: 'ai-error' });

    const editing = makeConversation({ state: 'editing', documentId: conv.documentId, stateVersion: 9 });
    const ready = await flow.handle(editing, makeEvent({ text: 'О закупке\n\nТекст' }));
    expect(ready[0].image).toEqual({ name: 'ready' });
    expect(ready[1].file).toBeDefined();
  });

  it('marks every text reply of the main path as HTML', async () => {
    const conv = makeConversation();
    const replies = [
      ...await flow.handle(conv, commandEvent('start')),
      ...await flow.handle(conv, commandEvent('help')),
      ...await flow.handle(conv, makeEvent({ text: 'Текст черновика' })),
      ...await flow.handle(conv, actionEvent({ a: 'show_draft', r: conv.stateVersion })),
      ...await flow.handle(conv, actionEvent({ a: 'continue', r: conv.stateVersion })),
      ...await flow.handle(conv, actionEvent({ a: 'set_type', v: 'memo', r: conv.stateVersion })),
      ...await flow.handle(conv, actionEvent({ a: 'set_template', v: 'classic', r: conv.stateVersion })),
      ...await flow.handle(conv, makeEvent({ text: 'ещё текст' })),
    ];
    const textReplies = replies.filter((reply) => reply.text !== undefined);
    expect(textReplies.length).toBeGreaterThan(5);
    for (const reply of textReplies) expect(reply.format, reply.text).toBe('html');
  });

  // ── Голосовые сообщения ────────────────────────────────────────────────

  it('treats a recognized voice message as a typed draft and echoes the transcript', async () => {
    const transcribeAudio = vi.fn(async () => ({ text: 'прошу выделить ноутбук' }));
    const voiceFlow = createFlow({ docServiceClient: client, docTypes: mockDocTypesService(), templates: mockTemplatesService(), log: mockLog, transcribeAudio });
    const conv = makeConversation();
    const audio = { type: 'audio', payload: { url: 'https://max.test/voice.ogg' } };

    const r = await voiceFlow.handle(conv, makeEvent({ kind: 'audio', audio }));

    expect(transcribeAudio).toHaveBeenCalledWith(audio, { platform: 'max', ownerId: 'user-1' });
    expect(r[0]).toMatchObject({ format: 'html' });
    expect(r[0].text).toContain('прошу выделить ноутбук');
    expect(r[1].text).toContain('Принято');
    expect(conv.state).toBe('collecting');
    expect(docs.get(conv.documentId).source_text).toBe('прошу выделить ноутбук');
  });

  it('asks to repeat when the voice message cannot be recognized', async () => {
    const transcribeAudio = vi.fn(async () => { throw Object.assign(new Error('Речь не распознана'), { code: 'STT_FAILED' }); });
    const voiceFlow = createFlow({ docServiceClient: client, docTypes: mockDocTypesService(), templates: mockTemplatesService(), log: mockLog, transcribeAudio });
    const conv = makeConversation();

    const r = await voiceFlow.handle(conv, makeEvent({ kind: 'audio', audio: { type: 'audio', payload: { url: 'u' } } }));

    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ format: 'html' });
    expect(r[0].text).toContain('Не удалось распознать');
    expect(conv.state).toBe('idle');
  });

  it('escapes the user draft before sending it back as HTML', async () => {
    const conv = makeConversation();
    await flow.handle(conv, makeEvent({ text: 'если a < b & c > d <b>жирно</b>' }));
    const r = await flow.handle(conv, actionEvent({ a: 'show_draft', r: conv.stateVersion }));
    expect(r[0].format).toBe('html');
    expect(r[0].text).toContain('a &lt; b &amp; c &gt; d &lt;b&gt;жирно&lt;/b&gt;');
  });
});
