import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import pino from 'pino';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createApp } from '../../src/app.js';
import { createDocumentService } from '../../src/core/documentService.js';
import { createQueue } from '../../src/jobs/queue.js';
import { rateLimiter } from '../../src/http/rateLimiter.js';

// ── Test helpers ──────────────────────────────────────────────────────────────

function createTestDb() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-test-'));
  const dbPath = path.join(tmpDir, 'test.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

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
    ['letter', { id: 'letter', name: 'Письмо', hint: 'letter', docTitle: null, layout: ['body'], structureHint: 'test', fields: [] }],
    ['reference', { id: 'reference', name: 'Справка', hint: 'reference', docTitle: null, layout: ['body'], structureHint: 'test', fields: [] }],
  ]);
  return { get: (id) => types.get(id) || null, list: () => [...types.values()] };
}

function createMockTemplates() {
  const templates = new Map([
    ['classic', { id: 'classic', name: 'Classic', description: 'Базовый шаблон', organization: { name: 'Test' }, page: { marginsMm: { top: 20, right: 20, bottom: 20, left: 20 } }, font: { family: 'Times New Roman', sizePt: 12 }, paragraph: { lineSpacing: 1.15, firstLineIndentMm: 12.5, align: 'justify', spaceAfterPt: 0 }, header: { pageNumber: 'none', firstPage: false, text: null }, footer: { text: null }, blocks: {}, placeholder: { format: '{label}', highlight: null }, autoFill: { date: true }, dateFormat: 'DD.MM.YYYY' }],
    ['modern', { id: 'modern', name: 'Modern', description: 'Современный шаблон', organization: { name: 'Test' }, page: { marginsMm: { top: 25, right: 25, bottom: 25, left: 25 } }, font: { family: 'Arial', sizePt: 11 }, paragraph: { lineSpacing: 1.5, firstLineIndentMm: 0, align: 'left', spaceAfterPt: 6 }, header: { pageNumber: 'right', firstPage: false, text: null }, footer: { text: null }, blocks: {}, placeholder: { format: '{label}', highlight: null }, autoFill: { date: true }, dateFormat: 'DD.MM.YYYY' }],
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
      const id = `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      // os.tmpdir(), а не '/tmp': на Windows такого каталога нет и запись падает
      const filePath = path.join(os.tmpdir(), `${id}.docx`);
      files.set(id, { buffer, filename, path: filePath });
      fs.writeFileSync(filePath, buffer);
      return { id, path: filePath, filename };
    },
    remove: (id) => { files.delete(id); },
    getPath: (id) => files.get(id)?.path || null,
  };
}

function createMockRenderDocx() {
  return async (model) => Buffer.from(`DOCX for ${model.docType?.name || 'unknown'}`);
}

function createMockLogger() {
  return pino({ level: 'silent' });
}

/**
 * Persistent test client — extracts and forwards cookies across requests.
 * Simulates a real browser session for cookie-based ownership.
 */
function createClient(app) {
  let sid = null;

  function setCookieFrom(res) {
    const setCookie = res.headers['set-cookie'];
    if (setCookie) {
      for (const raw of setCookie) {
        const match = raw.match(/^sid=([a-f0-9]+)/);
        if (match) {
          sid = match[1];
          break;
        }
      }
    }
  }

  function withCookie(req) {
    if (sid) req.set('Cookie', `sid=${sid}`);
    return req;
  }

  return {
    get: async (url) => {
      const res = await withCookie(request(app).get(url));
      setCookieFrom(res);
      return res;
    },
    post: async (url, body) => {
      const req = withCookie(request(app).post(url));
      if (body !== undefined) req.send(body);
      const res = await req;
      setCookieFrom(res);
      return res;
    },
    put: async (url, body) => {
      const req = withCookie(request(app).put(url));
      if (body !== undefined) req.send(body);
      const res = await req;
      setCookieFrom(res);
      return res;
    },
    patch: async (url, body) => {
      const req = withCookie(request(app).patch(url));
      if (body !== undefined) req.send(body);
      const res = await req;
      setCookieFrom(res);
      return res;
    },
    delete: async (url) => {
      const res = await withCookie(request(app).delete(url));
      setCookieFrom(res);
      return res;
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('REST API', () => {
  let app, db, tmpDir, documentService, fileStorage, appRateLimiter;

  beforeAll(() => {
    ({ db, tmpDir } = createTestDb());
    const queue = createQueue(db);
    const log = createMockLogger();
    fileStorage = createMockFileStorage();

    // Create a rate limiter instance we can reset between tests
    appRateLimiter = rateLimiter();

    documentService = createDocumentService({
      db,
      queue,
      fileStorage,
      docTypes: createMockDocTypes(),
      templates: createMockTemplates(),
      renderDocx: createMockRenderDocx(),
      log,
    });

    app = createApp({
      log,
      deps: {
        documentService,
        docTypes: createMockDocTypes(),
        templates: createMockTemplates(),
        fileStorage,
        db,
        rateLimiter: () => appRateLimiter,
      },
    });
  });

  afterAll(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    db.exec('DELETE FROM deliveries');
    db.exec('DELETE FROM files');
    db.exec('DELETE FROM versions');
    db.exec('DELETE FROM documents');
    db.exec('DELETE FROM jobs');
    db.exec('DELETE FROM processing_log');

    // Reset rate limiter state between tests
    if (appRateLimiter.reset) appRateLimiter.reset();
  });

  // ── Document type detection ───────────────────────────────────────────────

  describe('POST /api/detect-type', () => {
    it('asks the AI provider and returns its suggestion', async () => {
      const aiProvider = { name: 'test', complete: async () => '{"typeId":"report","confidence":0.8,"evidence":["докладываю"]}' };
      const aiApp = createApp({
        log: createMockLogger(),
        deps: { documentService, docTypes: createMockDocTypes(), templates: createMockTemplates(), fileStorage, db, aiProvider, rateLimiter: () => appRateLimiter },
      });
      const res = await request(aiApp).post('/api/detect-type').send({ sourceText: 'Докладываю о срыве поставки' });
      expect(res.status).toBe(200);
      expect(res.body.suggestion).toMatchObject({ typeId: 'report', confidence: 0.8, source: 'ai', evidence: ['докладываю'] });
    });

    it('answers with the keyword rules when no AI provider is configured', async () => {
      const res = await request(app).post('/api/detect-type').send({ sourceText: 'Докладываю о срыве поставки' });
      expect(res.status).toBe(200);
      expect(res.body.suggestion.source).toBe('rules');
    });
  });

  // ── Health ────────────────────────────────────────────────────────────────

  describe('GET /health', () => {
    it('returns 200 with ok, ai, and templates count', async () => {
      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.ai).toHaveProperty('provider');
      expect(res.body.ai).toHaveProperty('reachable');
      expect(typeof res.body.templates).toBe('number');
    });
  });

  // ── Catalog ───────────────────────────────────────────────────────────────

  describe('GET /api/catalog', () => {
    it('returns 200 with docTypes and templates', async () => {
      const res = await request(app).get('/api/catalog');

      expect(res.status).toBe(200);
      expect(res.body.docTypes).toBeDefined();
      expect(res.body.templates).toBeDefined();
      expect(res.body.docTypes.length).toBe(4);
      expect(res.body.templates.length).toBe(2);
    });
  });

  // ── Session ───────────────────────────────────────────────────────────────

  describe('Session management', () => {
    it('creates sid cookie on first request', async () => {
      const res = await request(app).get('/api/catalog');

      expect(res.status).toBe(200);
      expect(res.headers['set-cookie']).toBeDefined();
      expect(res.headers['set-cookie'][0]).toMatch(/sid=[a-f0-9]{32}/);
    });

    it('returns 404 for different owner (does not leak existence)', async () => {
      const client = createClient(app);
      const createRes = await client.post('/api/documents', { sourceText: 'test' });
      const docId = createRes.body.id;

      // New client = different session = different owner
      const otherClient = createClient(app);
      const getRes = await otherClient.get(`/api/documents/${docId}`);

      expect(getRes.status).toBe(404);
    });
  });

  // ── Full flow ─────────────────────────────────────────────────────────────

  describe('Full document flow', () => {
    it('create → set type → set template → process → set fields → render → download', async () => {
      const client = createClient(app);

      // 1. Create document with initial state
      const createRes = await client.post('/api/documents', {
        sourceText: 'Служебная записка о необходимости закупки оборудования',
        docType: 'memo',
        templateId: 'classic',
      });

      expect(createRes.status).toBe(201);
      const docId = createRes.body.id;
      expect(createRes.body.status).toBe('draft');
      expect(createRes.body.docType).toBe('memo');
      expect(createRes.body.templateId).toBe('classic');

      // 2. Get document
      const getRes = await client.get(`/api/documents/${docId}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.id).toBe(docId);

      // 3. Process
      const processRes = await client.post(`/api/documents/${docId}/process`, {});
      expect(processRes.status).toBe(202);
      expect(processRes.body.jobId).toBeDefined();

      // 4. Simulate processing complete (AI handler would do this)
      documentService.saveVersion({
        documentId: docId,
        draftVersion: 1,
        docType: 'memo',
        kind: 'ai',
        title: 'О закупке оборудования',
        body: ['Необходимо закупить оборудование для офиса'],
        aiFields: {},
        changes: [],
        warnings: [],
      });
      documentService.markProcessed(docId);

      // 5. Set fields
      const fieldsRes = await client.put(`/api/documents/${docId}/fields`, {
        author: 'Иванов И.И.',
        department: 'IT',
      });

      expect(fieldsRes.status).toBe(200);
      expect(fieldsRes.body.userFields.author).toBe('Иванов И.И.');
      expect(fieldsRes.body.userFields.department).toBe('IT');

      // 6. Render
      const renderRes = await client.post(`/api/documents/${docId}/render`, {});
      expect(renderRes.status).toBe(200);
      expect(renderRes.body.fileId).toBeDefined();
      expect(renderRes.body.downloadUrl).toMatch(/^\/api\/files\//);
      expect(renderRes.body.filename).toMatch(/\.docx$/);

      // 7. Download
      const downloadRes = await client.get(renderRes.body.downloadUrl);
      expect(downloadRes.status).toBe(200);
      expect(downloadRes.headers['content-type']).toMatch(/wordprocessingml/);
      expect(downloadRes.headers['content-disposition']).toMatch(/attachment/);
    });

    it('does not allow another web session to download the file', async () => {
      const owner = createClient(app);
      const stranger = createClient(app);
      const createRes = await owner.post('/api/documents', {
        sourceText: 'Закрытый документ', docType: 'memo', templateId: 'classic',
      });
      const docId = createRes.body.id;
      await owner.post(`/api/documents/${docId}/process`, {});
      documentService.saveVersion({
        documentId: docId,
        draftVersion: 1,
        docType: 'memo',
        kind: 'ai',
        title: 'Закрытый документ',
        body: ['Текст'],
        aiFields: {},
        changes: [],
        warnings: [],
      });
      documentService.markProcessed(docId);
      const renderRes = await owner.post(`/api/documents/${docId}/render`, {});

      const stolen = await stranger.get(renderRes.body.downloadUrl);
      expect(stolen.status).toBe(404);
    });
  });

  // ── List with pagination ──────────────────────────────────────────────────

  describe('GET /api/documents — pagination', () => {
    it('returns documents with limit and offset', async () => {
      const client = createClient(app);

      // Create 5 documents
      for (let i = 0; i < 5; i++) {
        await client.post('/api/documents', { sourceText: `doc ${i}` });
      }

      // Get first 2
      const page1 = await client.get('/api/documents?limit=2&offset=0');
      expect(page1.status).toBe(200);
      expect(page1.body.documents.length).toBe(2);
      expect(page1.body.total).toBe(5);

      // Get next 2
      const page2 = await client.get('/api/documents?limit=2&offset=2');
      expect(page2.status).toBe(200);
      expect(page2.body.documents.length).toBe(2);

      // Get last 1
      const page3 = await client.get('/api/documents?limit=2&offset=4');
      expect(page3.status).toBe(200);
      expect(page3.body.documents.length).toBe(1);
    });

    it('filters by status', async () => {
      const client = createClient(app);

      // Create document in draft state
      const doc1Res = await client.post('/api/documents', { sourceText: 'draft' });
      const doc1Id = doc1Res.body.id;

      // Create and process another document
      const doc2Res = await client.post('/api/documents', { sourceText: 'processed' });
      const doc2Id = doc2Res.body.id;

      await client.patch(`/api/documents/${doc2Id}`, { docType: 'memo', templateId: 'classic' });
      await client.post(`/api/documents/${doc2Id}/process`, {});

      documentService.saveVersion({
        documentId: doc2Id, draftVersion: 1, docType: 'memo',
        kind: 'ai', title: 'Test', body: ['body'], aiFields: {}, changes: [], warnings: [],
      });
      documentService.markProcessed(doc2Id);

      // Filter by draft
      const draftRes = await client.get('/api/documents?status=draft');
      expect(draftRes.body.documents.length).toBe(1);
      expect(draftRes.body.documents[0].id).toBe(doc1Id);

      // Filter by processed
      const processedRes = await client.get('/api/documents?status=processed');
      expect(processedRes.body.documents.length).toBe(1);
      expect(processedRes.body.documents[0].id).toBe(doc2Id);
    });
  });

  // ── Delete ────────────────────────────────────────────────────────────────

  describe('DELETE /api/documents/:id', () => {
    it('deletes document and returns 204', async () => {
      const client = createClient(app);

      const createRes = await client.post('/api/documents', { sourceText: 'test' });
      const docId = createRes.body.id;

      const deleteRes = await client.delete(`/api/documents/${docId}`);
      expect(deleteRes.status).toBe(204);

      // Verify 404 on subsequent GET
      const getRes = await client.get(`/api/documents/${docId}`);
      expect(getRes.status).toBe(404);
    });
  });

  // ── Manual text ───────────────────────────────────────────────────────────

  describe('PUT /api/documents/:id/text', () => {
    it('sets manual title and body', async () => {
      const client = createClient(app);

      const createRes = await client.post('/api/documents', { sourceText: 'test' });
      const docId = createRes.body.id;

      // Must set docType before setManualText (versions table requires it)
      await client.patch(`/api/documents/${docId}`, { docType: 'memo' });

      const textRes = await client.put(`/api/documents/${docId}/text`, {
        title: 'Manual Title',
        body: ['Paragraph 1', 'Paragraph 2'],
      });

      expect(textRes.status).toBe(200);
      expect(textRes.body.status).toBe('processed');
      expect(textRes.body.version.kind).toBe('manual');
      expect(textRes.body.version.title).toBe('Manual Title');
    });

    it('returns 400 for missing title', async () => {
      const client = createClient(app);

      const createRes = await client.post('/api/documents', { sourceText: 'test' });
      const docId = createRes.body.id;

      const textRes = await client.put(`/api/documents/${docId}/text`, {
        body: ['Paragraph 1'],
      });

      expect(textRes.status).toBe(400);
    });
  });

  // ── Processing log ────────────────────────────────────────────────────────

  describe('GET /api/documents/:id/log', () => {
    it('returns processing logs', async () => {
      const client = createClient(app);

      const createRes = await client.post('/api/documents', { sourceText: 'test' });
      const docId = createRes.body.id;

      // Write a log entry
      documentService.logProcessing({
        documentId: docId,
        jobId: 'job-123',
        stage: 'prompt',
        data: { prompt: 'test prompt' },
      });

      const logRes = await client.get(`/api/documents/${docId}/log`);
      expect(logRes.status).toBe(200);
      expect(logRes.body.logs.length).toBe(1);
      expect(logRes.body.logs[0].stage).toBe('prompt');
      expect(logRes.body.logs[0].data.prompt).toBe('test prompt');
    });
  });

  // ── Rate limiting ─────────────────────────────────────────────────────────

  describe('Rate limiting', () => {
    it('returns 429 after exceeding limit', async () => {
      const client = createClient(app);

      // Create a document first
      const createRes = await client.post('/api/documents', { sourceText: 'test' });
      const docId = createRes.body.id;

      // Hit the limit (31 requests)
      for (let i = 0; i < 31; i++) {
        await client.post(`/api/documents/${docId}/process`, {}).catch(() => {});
      }

      // The 31st request should be rate limited
      const rateRes = await client.post(`/api/documents/${docId}/process`, {});
      expect(rateRes.status).toBe(429);
      expect(rateRes.body.error.code).toBe('RATE_LIMITED');
    });
  });

  // ── Validation ────────────────────────────────────────────────────────────

  describe('Validation errors', () => {
    it('returns 400 for invalid doc type', async () => {
      const client = createClient(app);

      const createRes = await client.post('/api/documents', { sourceText: 'test' });
      const docId = createRes.body.id;

      const typeRes = await client.patch(`/api/documents/${docId}`, {
        docType: 'invalid-type',
      });

      expect(typeRes.status).toBe(400);
      expect(typeRes.body.error.code).toBe('UNKNOWN_TYPE');
    });

    it('returns 404 for non-existent document', async () => {
      const client = createClient(app);

      const getRes = await client.get('/api/documents/non-existent-id');
      expect(getRes.status).toBe(404);
    });
  });
});
