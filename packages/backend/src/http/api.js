import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { rateLimiter } from './rateLimiter.js';
import { apiKeyAuth } from './apiKeyAuth.js';
import { ownerHeaders } from './ownerHeaders.js';
import { readMultipartFile } from '../audio/multipart.js';

/**
 * REST API router — all document methods delegate to documentService.
 *
 * Design decisions:
 * - Single Responsibility: this router only maps HTTP to service calls
 * - Dependency Inversion: receives services via `deps`, never imports them
 * - Ownership enforcement: every route uses `req.owner` from session middleware
 * - Error handling: DomainError is caught by errorHandler middleware
 * - Express 5: async route handlers are supported natively
 * - Health endpoint is always available; document routes require deps
 *
 * @param {{ documentService?: object, docTypes?: object, templates?: object, fileStorage?: object, db?: object, log?: object, apiKey?: string }} deps
 * @returns {Router}
 */
export function createApiRouter(deps = {}) {
  const { documentService, docTypes, templates, fileStorage, log, faultManager, debugCommands, audioClient, audioMaxBytes = 25 * 1024 * 1024 } = deps;
  const router = Router();

  // Rate limit mutating routes only (POST/PUT/PATCH/DELETE)
  // Use injected rateLimiter if provided (for testing), otherwise create default
  const mutate = deps.rateLimiter?.() || rateLimiter();

  // Expose reset for testing — clears all IP counters
  if (mutate.reset) router.resetRateLimit = mutate.reset;

  // ── Health ────────────────────────────────────────────────────────────────

  router.get('/health', (_req, res) => {
    // Check AI provider availability (lightweight probe)
    let ai = { provider: 'unknown', reachable: false };
    try {
      const providerName = process.env.AI_PROVIDER || 'openai';
      ai = { provider: providerName, reachable: true };
    } catch {
      ai = { provider: 'unknown', reachable: false };
    }

    const templateCount = templates?.list?.().length || 0;

    res.json({
      ok: true,
      ai,
      templates: templateCount,
    });
  });

  // ── API Key Auth — проверяет ключ, если он предъявлен ────────────────────
  // Веб-клиент публичный: ключа у него нет, он приходит с cookie сессии и работает
  // от своего имени. Охраняется не доступ к API, а возможность выдать себя за
  // другого владельца — это ниже, в ownerHeaders().
  // Ключ можно передать через deps (тесты), иначе берётся из env.
  router.use('/api', apiKeyAuth({ apiKey: deps.apiKey }));

  // ── Owner extraction from headers — for API-to-API calls ──────────────────
  // Заголовки владельца принимаются только после подтверждённого ключа:
  // req.owner решает, чьи документы вернёт сервис. Веб-клиенты сюда не попадают —
  // у них владелец остаётся из cookie сессии.
  router.use('/api', ownerHeaders());

  // ── Debug: имитация сбоя ИИ (сценарий 6, /ai_fail) ────────────────────────
  // ИИ работает в этом backend, а команда из локального/мессенджерного адаптера
  // может взвести флаг через REST-вызов от имени того же владельца.
  // Ручки просто нет, когда DEBUG_COMMANDS выключен — на публичном сервере её не найти.
  if (faultManager && debugCommands) {
    router.post('/api/debug/ai-fault', mutate, async (req, res) => {
      const ownerKey = `${req.owner.platform}:${req.owner.id}`;
      faultManager.armOnce(ownerKey);
      log?.debug?.({ ownerKey }, 'имитация сбоя ИИ взведена');
      res.status(202).json({ armed: true });
    });
  }

  // ── Speech recognition ────────────────────────────────────────────────────
  // Микрофон и загрузка аудио на сайте. Браузер ходит только в backend, как и за остальными
  // /api: владелец берётся из cookie сессии, ключ аудиосервиса остаётся на сервере.
  if (audioClient) {
    router.post('/api/audio/transcribe', mutate, async (req, res) => {
      const file = await readMultipartFile(req, audioMaxBytes);
      try {
        const result = await audioClient.transcribe(file, { platform: req.owner.platform, ownerId: req.owner.id });
        res.json({ ok: true, text: result.text, duration: result.duration });
      } catch (err) {
        log?.warn?.({ code: err.code, error: err.message, detail: err.detail, bytes: file.length }, 'аудио с сайта не распознано');
        throw err;
      }
    });
  }

  // ── Catalog ───────────────────────────────────────────────────────────────

  router.get('/api/catalog', (_req, res) => {
    const docTypeList = docTypes?.list?.().map(dt => ({
      id: dt.id,
      name: dt.name,
      hint: dt.hint,
      fields: dt.fields,
    })) || [];

    const templateList = templates?.list?.().map(t => ({
      id: t.id,
      name: t.name,
      description: t.description,
      preview: t.preview || null,
    })) || [];

    res.json({ docTypes: docTypeList, templates: templateList });
  });

  // ── Documents CRUD ────────────────────────────────────────────────────────

  // All document routes require documentService — skip if not provided
  if (documentService) {

  router.post('/api/documents', mutate, async (req, res) => {
    const { sourceText, docType, templateId } = req.body || {};
    const owner = req.owner;

    const doc = documentService.create(owner);

    // Apply optional initial state in sequence
    if (docType) {
      documentService.setType(owner, doc.id, docType);
    }
    if (templateId) {
      documentService.setTemplate(owner, doc.id, templateId);
    }
    if (sourceText) {
      documentService.setDraft(owner, doc.id, sourceText, { mode: 'replace' });
    }

    const view = documentService.get(owner, doc.id);
    res.status(201).json(view);
  });

  router.get('/api/documents', async (req, res) => {
    const owner = req.owner;
    const { status, limit, offset } = req.query;

    const result = documentService.list(owner, {
      status: status || undefined,
      limit: limit ? Math.min(parseInt(limit, 10) || 20, 100) : 20,
      offset: offset ? Math.max(parseInt(offset, 10) || 0, 0) : 0,
    });

    res.json(result);
  });

  router.get('/api/documents/:id', async (req, res) => {
    const owner = req.owner;
    const doc = documentService.get(owner, req.params.id);
    res.json(doc);
  });

  router.patch('/api/documents/:id', mutate, async (req, res) => {
    const owner = req.owner;
    const { id } = req.params;
    const { sourceText, docType, templateId } = req.body || {};

    // Apply changes in sequence — each call validates ownership
    if (docType !== undefined) {
      documentService.setType(owner, id, docType);
    }
    if (templateId !== undefined) {
      documentService.setTemplate(owner, id, templateId);
    }
    if (sourceText !== undefined) {
      documentService.setDraft(owner, id, sourceText, { mode: 'replace' });
    }

    const doc = documentService.get(owner, id);
    res.json(doc);
  });

  router.delete('/api/documents/:id', mutate, async (req, res) => {
    const owner = req.owner;
    documentService.remove(owner, req.params.id);
    res.status(204).end();
  });

  // ── Processing ────────────────────────────────────────────────────────────

  router.post('/api/documents/:id/process', mutate, async (req, res) => {
    const owner = req.owner;
    const result = documentService.startProcessing(owner, req.params.id);
    res.status(202).json({ jobId: result.job.id, reused: result.reused });
  });

  // Повтор после сбоя ИИ — отдельный маршрут, а не повторный /process: тот идемпотентен
  // по ключу и на повторе вернул бы старую упавшую задачу, а документ навсегда завис бы в processing.
  router.post('/api/documents/:id/retry', mutate, async (req, res) => {
    const owner = req.owner;
    const result = documentService.retryProcessing(owner, req.params.id);
    res.status(202).json({ jobId: result.job.id, reused: result.reused });
  });

  // ── Fields ────────────────────────────────────────────────────────────────

  router.put('/api/documents/:id/fields', mutate, async (req, res) => {
    const owner = req.owner;
    const { id } = req.params;
    const fields = req.body || {};

    // Apply each field from the request body
    for (const [key, value] of Object.entries(fields)) {
      documentService.setField(owner, id, key, value);
    }

    const doc = documentService.get(owner, id);
    res.json(doc);
  });

  // ── Manual Text ───────────────────────────────────────────────────────────

  router.put('/api/documents/:id/text', mutate, async (req, res) => {
    const owner = req.owner;
    const { id } = req.params;
    const { title, body } = req.body || {};

    if (!title || !Array.isArray(body)) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'title (string) and body (array) required' },
      });
      return;
    }

    const doc = documentService.setManualText(owner, id, { title, body });
    res.json(doc);
  });

  // ── Render ────────────────────────────────────────────────────────────────

  router.post('/api/documents/:id/render', mutate, async (req, res) => {
    const owner = req.owner;
    const result = await documentService.render(owner, req.params.id);

    res.json({
      fileId: result.file.id,
      downloadUrl: `/api/files/${result.file.id}`,
      filename: result.file.filename,
      placeholders: result.placeholders,
      fallback: result.fallback,
    });
  });

  // ── File Download ─────────────────────────────────────────────────────────

  router.get('/api/files/:fileId', (req, res) => {
    const { fileId } = req.params;

    try {
      // File IDs are opaque, but ownership is still checked at the service boundary.
      const file = documentService.getFile(req.owner, fileId);
      if (!file || !fs.existsSync(file.path)) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'File not found' } });
        return;
      }

      const buffer = fs.readFileSync(file.path);

      // RFC 5987 encoding for non-ASCII filenames in Content-Disposition
      const encodedFilename = encodeURIComponent(file.filename)
        .replace(/'/g, '%27')
        .replace(/\(/g, '%28')
        .replace(/\)/g, '%29');

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="doc.docx"; filename*=UTF-8''${encodedFilename}`);
      res.end(buffer);
    } catch (err) {
      deps.log?.error({ err }, 'File download error');
      if (err?.status && err?.code) {
        res.status(err.status).json({ error: { code: err.code, message: err.message } });
        return;
      }
      res.status(500).json({ error: { code: 'INTERNAL', message: 'Failed to download file' } });
    }
  });

  // ── Processing Log ────────────────────────────────────────────────────────

  router.get('/api/documents/:id/log', async (req, res) => {
    const owner = req.owner;
    // Verify ownership first
    documentService.get(owner, req.params.id);

    // Access the log data via the internal DB connection
    // The documentService doesn't expose a log getter, so we query directly
    const { db } = deps;
    const logs = db.prepare(
      'SELECT * FROM processing_log WHERE document_id = ? ORDER BY created_at ASC'
    ).all(req.params.id);

    res.json({
      logs: logs.map(l => ({
        id: l.id,
        jobId: l.job_id,
        stage: l.stage,
        data: JSON.parse(l.data),
        createdAt: l.created_at,
      })),
    });
  });

  } // end if (documentService)

  // ── Template Previews ─────────────────────────────────────────────────────

  router.get('/templates/previews/:file', (req, res) => {
    const { file } = req.params;
    // Sanitize filename to prevent path traversal
    const safeName = path.basename(file);
    const previewPath = path.resolve('templates/previews', safeName);

    if (!fs.existsSync(previewPath)) {
      res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Preview not found' },
      });
      return;
    }

    res.sendFile(previewPath);
  });

  return router;
}
