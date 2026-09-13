import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createDocumentService } from '../../src/core/documentService.js';
import { createQueue } from '../../src/jobs/queue.js';

// ── Test helpers ──────────────────────────────────────────────────────────────

function createTestDb() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-service-test-'));
  const dbPath = path.join(tmpDir, 'test.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Run migrations
  const migration = fs.readFileSync(
    path.resolve(import.meta.dirname, '../../src/db/migrations/001_init.sql'),
    'utf8'
  );
  db.exec(migration);

  return { db, tmpDir };
}

function createMockDocTypes() {
  const types = new Map([
    ['memo', { id: 'memo', name: 'Служебная записка', hint: 'memo', docTitle: null, layout: ['body'], structureHint: 'test', fields: [] }],
    ['report', { id: 'report', name: 'Отчёт', hint: 'report', docTitle: null, layout: ['body'], structureHint: 'test', fields: [] }],
  ]);
  return { get: (id) => types.get(id) || null, list: () => [...types.values()] };
}

function createMockTemplates() {
  const templates = new Map([
    ['classic', { id: 'classic', name: 'Classic', description: 'test', organization: { name: 'Test' }, page: { marginsMm: { top: 20, right: 20, bottom: 20, left: 20 } }, font: { family: 'Times New Roman', sizePt: 12 }, paragraph: { lineSpacing: 1.15, firstLineIndentMm: 12.5, align: 'justify', spaceAfterPt: 0 }, header: { pageNumber: 'none', firstPage: false, text: null }, footer: { text: null }, blocks: {}, placeholder: { format: '{label}', highlight: null }, autoFill: { date: true }, dateFormat: 'DD.MM.YYYY' }],
  ]);
  return {
    get: (id) => {
      const template = templates.get(id);
      if (template) return { template, fallback: null };
      return { template: templates.get('classic'), fallback: { requestedId: id, reason: 'missing' } };
    },
    list: () => [...templates.values()],
  };
}

function createMockFileStorage() {
  const files = new Map();
  return {
    save: (buffer, filename) => {
      const id = `file-${Date.now()}`;
      files.set(id, { buffer, filename });
      return { id, path: `/tmp/${id}.docx`, filename };
    },
    remove: (id) => { files.delete(id); },
    getPath: (id) => `/tmp/${id}.docx`,
  };
}

function createMockRenderDocx() {
  return async (model) => Buffer.from(`DOCX for ${model.docType?.name || 'unknown'}`);
}

function createMockLogger() {
  return { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DocumentService', () => {
  let db, tmpDir, service, queue;
  const owner = { platform: 'telegram', id: 'user-123' };
  const otherOwner = { platform: 'telegram', id: 'user-999' };

  beforeAll(() => {
    ({ db, tmpDir } = createTestDb());
    queue = createQueue(db);
    service = createDocumentService({
      db,
      queue,
      fileStorage: createMockFileStorage(),
      docTypes: createMockDocTypes(),
      templates: createMockTemplates(),
      renderDocx: createMockRenderDocx(),
      log: createMockLogger(),
    });
  });

  afterAll(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    // Clean tables between tests to prevent data accumulation
    db.exec('DELETE FROM deliveries');
    db.exec('DELETE FROM files');
    db.exec('DELETE FROM versions');
    db.exec('DELETE FROM documents');
    db.exec('DELETE FROM jobs');
    db.exec('DELETE FROM processing_log');
  });

  // ── Create ──────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates document with status draft', () => {
      const doc = service.create(owner);
      expect(doc).toBeDefined();
      expect(doc.id).toBeDefined();
      expect(doc.status).toBe('draft');
      expect(doc.docType).toBeNull();
      expect(doc.templateId).toBeNull();
      expect(doc.sourceText).toBe('');
      expect(doc.draftVersion).toBe(0);
      expect(doc.userFields).toEqual({});
    });
  });

  // ── Set Draft ───────────────────────────────────────────────────────────────

  describe('setDraft', () => {
    let docId;

    beforeEach(() => {
      docId = service.create(owner).id;
    });

    it('appends text and increments draft_version', () => {
      const doc1 = service.setDraft(owner, docId, 'Hello');
      expect(doc1.sourceText).toBe('Hello');
      expect(doc1.draftVersion).toBe(1);

      const doc2 = service.setDraft(owner, docId, 'World');
      expect(doc2.sourceText).toBe('Hello\nWorld');
      expect(doc2.draftVersion).toBe(2);
    });

    it('replaces text in replace mode', () => {
      service.setDraft(owner, docId, 'Hello');
      const doc = service.setDraft(owner, docId, 'World', { mode: 'replace' });
      expect(doc.sourceText).toBe('World');
      expect(doc.draftVersion).toBe(2);
    });

    it('throws DRAFT_TOO_LONG for text > 20000 chars', () => {
      const longText = 'x'.repeat(20001);
      expect(() => service.setDraft(owner, docId, longText)).toThrow('Draft exceeds 20000 characters');
    });

    it('throws BUSY when document is processing', () => {
      service.setDraft(owner, docId, 'text');
      service.setType(owner, docId, 'memo');
      service.setTemplate(owner, docId, 'classic');
      service.startProcessing(owner, docId);
      expect(() => service.setDraft(owner, docId, 'more')).toThrow('Document is being processed');
    });
  });

  // ── Set Type ────────────────────────────────────────────────────────────────

  describe('setType', () => {
    let docId;

    beforeEach(() => {
      docId = service.create(owner).id;
    });

    it('sets doc_type', () => {
      const doc = service.setType(owner, docId, 'memo');
      expect(doc.docType).toBe('memo');
    });

    it('throws UNKNOWN_TYPE for invalid type', () => {
      expect(() => service.setType(owner, docId, 'unknown')).toThrow('Unknown document type');
    });

    it('clears current_version_id after processing when type changes', () => {
      service.setDraft(owner, docId, 'text');
      service.setType(owner, docId, 'memo');
      service.setTemplate(owner, docId, 'classic');
      service.startProcessing(owner, docId);

      // Simulate processing complete
      const versionId = service.saveVersion({
        documentId: docId, draftVersion: 1, docType: 'memo',
        kind: 'ai', title: 'Test', body: ['paragraph'],
        aiFields: {}, changes: [], warnings: [],
      });
      service.markProcessed(docId);

      // Change type after processing
      const doc = service.setType(owner, docId, 'report');
      expect(doc.version).toBeNull(); // version cleared
    });
  });

  // ── Set Template ────────────────────────────────────────────────────────────

  describe('setTemplate', () => {
    let docId;

    beforeEach(() => {
      docId = service.create(owner).id;
    });

    it('sets template_id', () => {
      const doc = service.setTemplate(owner, docId, 'classic');
      expect(doc.templateId).toBe('classic');
    });
  });

  // ── Start Processing ────────────────────────────────────────────────────────

  describe('startProcessing', () => {
    let docId;

    beforeEach(() => {
      docId = service.create(owner).id;
    });

    it('enqueues job and sets status to processing', () => {
      service.setDraft(owner, docId, 'Some text');
      service.setType(owner, docId, 'memo');
      service.setTemplate(owner, docId, 'classic');

      const result = service.startProcessing(owner, docId);
      expect(result.job).toBeDefined();
      expect(result.reused).toBe(false);

      const doc = service.get(owner, docId);
      expect(doc.status).toBe('processing');
    });

    it('throws DRAFT_EMPTY when no text', () => {
      service.setType(owner, docId, 'memo');
      service.setTemplate(owner, docId, 'classic');
      expect(() => service.startProcessing(owner, docId)).toThrow('No draft text');
    });

    it('throws VALIDATION_ERROR when no type', () => {
      service.setDraft(owner, docId, 'text');
      service.setTemplate(owner, docId, 'classic');
      expect(() => service.startProcessing(owner, docId)).toThrow('No document type');
    });

    it('throws VALIDATION_ERROR when no template', () => {
      service.setDraft(owner, docId, 'text');
      service.setType(owner, docId, 'memo');
      expect(() => service.startProcessing(owner, docId)).toThrow('No template selected');
    });
  });

  // ── Retry Processing ────────────────────────────────────────────────────────

  describe('retryProcessing', () => {
    let docId;

    beforeEach(() => {
      docId = service.create(owner).id;
      service.setDraft(owner, docId, 'text');
      service.setType(owner, docId, 'memo');
      service.setTemplate(owner, docId, 'classic');
      service.startProcessing(owner, docId);
    });

    it('enqueues new job from ai_failed status', () => {
      // Simulate AI failure
      db.prepare('UPDATE documents SET status = ?, last_error = ? WHERE id = ?')
        .run('ai_failed', 'attempt 1 failed', docId);

      const result = service.retryProcessing(owner, docId);
      expect(result.job).toBeDefined();
      expect(result.reused).toBe(false);

      const doc = service.get(owner, docId);
      expect(doc.status).toBe('processing');
    });

    it('throws when not in ai_failed status', () => {
      expect(() => service.retryProcessing(owner, docId)).toThrow('Can only retry from ai_failed status');
    });
  });

  // ── Set Field ───────────────────────────────────────────────────────────────

  describe('setField', () => {
    let docId;

    beforeEach(() => {
      docId = service.create(owner).id;
    });

    it('sets field value', () => {
      const doc = service.setField(owner, docId, 'author', 'Иванов И.И.');
      expect(doc.userFields.author).toBe('Иванов И.И.');
    });

    it('sets field to null', () => {
      service.setField(owner, docId, 'author', 'Иванов');
      const doc = service.setField(owner, docId, 'author', null);
      expect(doc.userFields.author).toBeNull();
    });

    it('truncates field to 300 chars', () => {
      const longValue = 'x'.repeat(400);
      const doc = service.setField(owner, docId, 'author', longValue);
      expect(doc.userFields.author.length).toBe(300);
    });
  });

  // ── Set Manual Text ─────────────────────────────────────────────────────────

  describe('setManualText', () => {
    let docId;

    beforeEach(() => {
      docId = service.create(owner).id;
      service.setDraft(owner, docId, 'text');
      service.setType(owner, docId, 'memo');
    });

    it('creates manual version and marks as processed', () => {
      const doc = service.setManualText(owner, docId, {
        title: 'Manual Title',
        body: ['Paragraph 1', 'Paragraph 2'],
      });
      expect(doc.status).toBe('processed');
      expect(doc.version).not.toBeNull();
      expect(doc.version.kind).toBe('manual');
      expect(doc.version.title).toBe('Manual Title');
    });

    it('keeps the AI title and requisites when the edit sends a generic title, and drops markup', () => {
      service.saveVersion({
        documentId: docId, draftVersion: 1, docType: 'memo', kind: 'ai',
        title: 'О закупке мониторов', body: ['Текст'],
        aiFields: { 'Адресат': { value: 'Директору Иванову И. И.', quote: 'директору иванову' } },
        changes: [], warnings: [],
      });
      service.markProcessed(docId);

      const doc = service.setManualText(owner, docId, { title: 'Документ', body: ['<b>Прошу</b> выделить'] });
      expect(doc.version.title).toBe('О закупке мониторов');
      expect(doc.version.body).toEqual(['Прошу выделить']);
      expect(doc.version.aiFields['Адресат'].value).toBe('Директору Иванову И. И.');
    });
  });

  // ── Save Version ────────────────────────────────────────────────────────────

  describe('saveVersion', () => {
    it('returns version ID', () => {
      const docId = service.create(owner).id;
      const versionId = service.saveVersion({
        documentId: docId, draftVersion: 1, docType: 'memo',
        kind: 'ai', title: 'Test', body: ['paragraph'],
        aiFields: { author: { value: 'Test', quote: 'test' } },
        changes: ['Fixed formatting'], warnings: ['Check dates'],
      });
      expect(versionId).toBeDefined();
      expect(typeof versionId).toBe('string');
    });
  });

  // ── Mark Processed ──────────────────────────────────────────────────────────

  describe('markProcessed', () => {
    it('no-op for non-existent document', () => {
      // Should not throw
      service.markProcessed('non-existent-id');
    });
  });

  // ── Render ──────────────────────────────────────────────────────────────────

  describe('render', () => {
    let docId;

    beforeEach(() => {
      docId = service.create(owner).id;
    });

    it('throws NOT_READY when no version', async () => {
      await expect(service.render(owner, docId)).rejects.toThrow('No processed version available');
    });

    it('throws NOT_READY when version is stale', async () => {
      service.setDraft(owner, docId, 'text');
      service.setType(owner, docId, 'memo');
      service.setTemplate(owner, docId, 'classic');
      service.startProcessing(owner, docId);

      // Create version at draft_version 1
      service.saveVersion({
        documentId: docId, draftVersion: 1, docType: 'memo',
        kind: 'ai', title: 'Test', body: ['paragraph'],
        aiFields: {}, changes: [], warnings: [],
      });
      service.markProcessed(docId);

      // Increment draft (makes version stale)
      service.setDraft(owner, docId, 'more text');

      await expect(service.render(owner, docId)).rejects.toThrow('Version is stale');
    });
  });

  // ── Get ─────────────────────────────────────────────────────────────────────

  describe('get', () => {
    it('returns document view', () => {
      const created = service.create(owner);
      const doc = service.get(owner, created.id);
      expect(doc.id).toBe(created.id);
      expect(doc.status).toBe('draft');
    });

    it('throws NOT_FOUND for non-existent', () => {
      expect(() => service.get(owner, 'non-existent')).toThrow('Document not found');
    });

    it('throws FORBIDDEN for wrong owner', () => {
      const doc = service.create(owner);
      // Query with wrong owner returns null → NOT_FOUND
      // This is expected behavior — we don't leak document existence
      expect(() => service.get(otherOwner, doc.id)).toThrow('Document not found');
    });
  });

  // ── List ────────────────────────────────────────────────────────────────────

  describe('list', () => {
    it('lists documents for owner', () => {
      service.create(owner);
      service.create(owner);
      const result = service.list(owner, { limit: 100 });
      expect(result.documents.length).toBe(2);
      expect(result.total).toBe(2);
    });

    it('filters by status', () => {
      const doc1 = service.create(owner);
      const doc2 = service.create(owner);
      service.setDraft(owner, doc1.id, 'text');
      service.setType(owner, doc1.id, 'memo');
      service.setTemplate(owner, doc1.id, 'classic');
      service.startProcessing(owner, doc1.id);

      const result = service.list(owner, { status: 'processing', limit: 100 });
      expect(result.documents.length).toBe(1);
      expect(result.documents[0].id).toBe(doc1.id);
    });

    it('does not list other owners documents', () => {
      service.create(owner);
      service.create(otherOwner);
      const result = service.list(owner, { limit: 100 });
      expect(result.documents.length).toBe(1);
    });
  });

  // ── Remove ──────────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('deletes document and related data', () => {
      const doc = service.create(owner);
      service.setDraft(owner, doc.id, 'text');
      service.remove(owner, doc.id);

      expect(() => service.get(owner, doc.id)).toThrow('Document not found');
    });

    it('throws NOT_FOUND for wrong owner', () => {
      const doc = service.create(owner);
      // Query with wrong owner returns null → NOT_FOUND
      expect(() => service.remove(otherOwner, doc.id)).toThrow('Document not found');
    });
  });

  // ── Get Internal ────────────────────────────────────────────────────────────

  describe('getInternal', () => {
    it('returns raw document without owner check', () => {
      const doc = service.create(owner);
      const raw = service.getInternal(doc.id);
      expect(raw).toBeDefined();
      expect(raw.id).toBe(doc.id);
    });

    it('returns null for non-existent', () => {
      const raw = service.getInternal('non-existent');
      expect(raw).toBeNull();
    });
  });

  // ── Log Processing ──────────────────────────────────────────────────────────

  describe('logProcessing', () => {
    it('writes to processing_log', () => {
      const docId = service.create(owner).id;
      service.logProcessing({
        documentId: docId,
        jobId: 'job-123',
        stage: 'prompt',
        data: { prompt: 'test prompt' },
      });

      const log = db.prepare('SELECT * FROM processing_log WHERE document_id = ?').get(docId);
      expect(log).toBeDefined();
      expect(log.stage).toBe('prompt');
      expect(JSON.parse(log.data)).toEqual({ prompt: 'test prompt' });
    });
  });

  // ── Foreign Owner ───────────────────────────────────────────────────────────

  describe('foreign owner protection', () => {
    it('setDraft throws NOT_FOUND for wrong owner', () => {
      const doc = service.create(owner);
      // Query with wrong owner returns null → NOT_FOUND
      expect(() => service.setDraft(otherOwner, doc.id, 'text')).toThrow('Document not found');
    });

    it('setType throws NOT_FOUND for wrong owner', () => {
      const doc = service.create(owner);
      expect(() => service.setType(otherOwner, doc.id, 'memo')).toThrow('Document not found');
    });

    it('setTemplate throws NOT_FOUND for wrong owner', () => {
      const doc = service.create(owner);
      expect(() => service.setTemplate(otherOwner, doc.id, 'classic')).toThrow('Document not found');
    });

    it('startProcessing throws NOT_FOUND for wrong owner', () => {
      const doc = service.create(owner);
      expect(() => service.startProcessing(otherOwner, doc.id)).toThrow('Document not found');
    });

    it('setField throws NOT_FOUND for wrong owner', () => {
      const doc = service.create(owner);
      expect(() => service.setField(otherOwner, doc.id, 'key', 'value')).toThrow('Document not found');
    });

    it('setManualText throws NOT_FOUND for wrong owner', () => {
      const doc = service.create(owner);
      expect(() => service.setManualText(otherOwner, doc.id, { title: 't', body: [] })).toThrow('Document not found');
    });
  });
});
