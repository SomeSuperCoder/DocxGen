import crypto from 'node:crypto';
import { mergeRequisites } from '../validation/requisites.js';
import { stripMarkup } from '../validation/normalize.js';
import { DomainError } from './errors.js';
import { normalizeRussianRequisite } from '../features/killer.js';

/**
 * Create the document service — the CENTRAL service for document lifecycle.
 *
 * Called by both the dialog engine and REST API. All methods take
 * `owner = { platform, id }` and throw DomainError('FORBIDDEN') if the
 * document belongs to someone else.
 *
 * RESPONSIBILITIES (Single Responsibility):
 * - Document CRUD with ownership enforcement
 * - Draft management (append/replace, length validation)
 * - Version tracking (staleness detection)
 * - Field updates with truncation
 * - Processing orchestration (enqueue jobs, track status)
 * - Render orchestration (DOCX generation with file caching)
 * - Processing log management
 *
 * DEPENDENCIES (injected — Dependency Inversion):
 * - db: better-sqlite3 Database instance
 * - queue: job queue (createQueue interface)
 * - fileStorage: file storage backend (createFileStorage interface)
 * - docTypes: document type catalog (loadDocTypes interface)
 * - templates: template catalog (loadTemplates interface)
 * - renderDocx: DOCX rendering function
 * - log: pino-compatible logger
 *
 * @param {{ db: object, queue: object, fileStorage: object, docTypes: object, templates: object, renderDocx: function, log: object }} deps
 */
export function createDocumentService({ db, queue, fileStorage, docTypes, templates, renderDocx, log }) {
  const MAX_DRAFT_LENGTH = 20000;

  // ── Prepared statements ─────────────────────────────────────────────────────
  // SSOT: all SQL lives here, never duplicated across methods.

  const insertDoc = db.prepare(`
    INSERT INTO documents (id, owner_platform, owner_id, doc_type, template_id, source_text, draft_version, user_fields, status, created_at, updated_at)
    VALUES (@id, @ownerPlatform, @ownerId, @docType, @templateId, @sourceText, @draftVersion, @userFields, @status, @now, @now)
  `);

  const getDoc = db.prepare('SELECT * FROM documents WHERE id = ?');

  const getDocByOwner = db.prepare(
    'SELECT * FROM documents WHERE id = ? AND owner_platform = ? AND owner_id = ?'
  );

  const updateDoc = db.prepare(`
    UPDATE documents SET doc_type = @docType, template_id = @templateId, source_text = @sourceText,
      draft_version = @draftVersion, user_fields = @userFields, status = @status,
      current_version_id = @currentVersionId, last_error = @lastError, updated_at = @now
    WHERE id = @id
  `);

  const insertVersion = db.prepare(`
    INSERT INTO versions (id, document_id, draft_version, doc_type, kind, title, body, ai_fields, changes, warnings, created_at)
    VALUES (@id, @documentId, @draftVersion, @docType, @kind, @title, @body, @aiFields, @changes, @warnings, @now)
  `);

  const getVersion = db.prepare('SELECT * FROM versions WHERE id = ?');

  const listDocs = db.prepare(`
    SELECT * FROM documents WHERE owner_platform = ? AND owner_id = ?
    ORDER BY updated_at DESC LIMIT ? OFFSET ?
  `);

  const countDocs = db.prepare(`
    SELECT COUNT(*) as total FROM documents WHERE owner_platform = ? AND owner_id = ?
  `);

  const deleteDoc = db.prepare(
    'DELETE FROM documents WHERE id = ? AND owner_platform = ? AND owner_id = ?'
  );

  const deleteVersions = db.prepare('DELETE FROM versions WHERE document_id = ?');

  const deleteFiles = db.prepare('DELETE FROM files WHERE document_id = ?');

  const deleteDeliveries = db.prepare(`
    DELETE FROM deliveries WHERE file_id IN (SELECT id FROM files WHERE document_id = ?)
  `);

  const insertFile = db.prepare(`
    INSERT INTO files (id, document_id, version_id, template_id, fields_hash, path, filename, placeholders, created_at)
    VALUES (@id, @documentId, @versionId, @templateId, @fieldsHash, @path, @filename, @placeholders, @now)
  `);

  const getFile = db.prepare('SELECT * FROM files WHERE id = ?');

  const findFile = db.prepare(`
    SELECT * FROM files WHERE version_id = ? AND template_id = ? AND fields_hash = ?
  `);

  const insertLog = db.prepare(`
    INSERT INTO processing_log (document_id, job_id, stage, data, created_at)
    VALUES (@documentId, @jobId, @stage, @data, @now)
  `);

  // ── Internal helpers ────────────────────────────────────────────────────────

  /**
   * Enforce ownership. Throws DomainError('FORBIDDEN') if doc belongs to someone else.
   * Single Responsibility: access control check.
   */
  function ensureOwner(doc, owner) {
    if (!doc) throw new DomainError('NOT_FOUND', 'Document not found', 404);
    if (doc.owner_platform !== owner.platform || doc.owner_id !== owner.id) {
      throw new DomainError('FORBIDDEN', 'Access denied', 403);
    }
  }

  /**
   * Transform raw DB row into a view object for API consumers.
   * Handles JSON parsing and staleness detection.
   * Single Responsibility: data transformation for read operations.
   */
  function toView(doc) {
    if (!doc) return null;
    const version = doc.current_version_id ? getVersion.get(doc.current_version_id) : null;
    const aiFields = version ? JSON.parse(version.ai_fields || '{}') : {};
    const userFields = JSON.parse(doc.user_fields || '{}');
    let pending = [];
    let placeholders = [];
    if (version && doc.doc_type && doc.template_id) {
      const docType = docTypes.get(doc.doc_type);
      const { template } = templates.get(doc.template_id);
      if (docType && template) {
        const merged = mergeRequisites({
          docType,
          template,
          aiFields,
          title: version.title,
          userFields,
          today: new Date().toISOString().slice(0, 10),
        });
        pending = merged.pending;
        placeholders = merged.placeholders;
      }
    }
    return {
      id: doc.id,
      status: doc.status,
      docType: doc.doc_type,
      templateId: doc.template_id,
      sourceText: doc.source_text,
      draftVersion: doc.draft_version,
      userFields,
      version: version ? {
        id: version.id,
        kind: version.kind,
        title: version.title,
        body: JSON.parse(version.body || '[]'),
        // Requisites extracted by the AI and verified by grounding — the dialog and render need them,
        // otherwise the bot asks the user for values the AI already found.
        aiFields,
        sourceQuotes: Object.fromEntries(Object.entries(aiFields).map(([key, value]) => [key, value?.quote || null])),
        changes: JSON.parse(version.changes || '[]'),
        warnings: JSON.parse(version.warnings || '[]'),
        // A version is stale when the draft OR the document type changed after processing.
        stale: version.draft_version !== doc.draft_version || version.doc_type !== doc.doc_type,
      } : null,
      pending,
      placeholders,
      error: doc.last_error,
      createdAt: doc.created_at,
      updatedAt: doc.updated_at,
    };
  }

  function now() { return new Date().toISOString(); }

  // ── Public API ──────────────────────────────────────────────────────────────

  return {
    /**
     * Create a new document in draft status.
     * @param {{ platform: string, id: string }} owner
     * @returns {object} document view
     */
    create(owner) {
      const id = crypto.randomUUID();
      const n = now();
      insertDoc.run({
        id, ownerPlatform: owner.platform, ownerId: owner.id,
        docType: null, templateId: null, sourceText: '',
        draftVersion: 0, userFields: '{}', status: 'draft', now: n,
      });
      log?.debug({ documentId: id, owner: `${owner.platform}:${owner.id}` }, 'документ создан');
      return toView(getDoc.get(id));
    },

    /**
     * Set draft text (append or replace mode).
     * Increments draft_version to signal staleness of any existing version.
     *
     * @param {{ platform: string, id: string }} owner
     * @param {string} id - document ID
     * @param {string} text - new text content
     * @param {{ mode?: 'append' | 'replace' }} options
     * @returns {object} document view
     */
    setDraft(owner, id, text, { mode = 'append' } = {}) {
      const doc = getDocByOwner.get(id, owner.platform, owner.id);
      ensureOwner(doc, owner);

      if (doc.status === 'processing') {
        throw new DomainError('BUSY', 'Document is being processed', 409);
      }

      if (text.length > MAX_DRAFT_LENGTH) {
        throw new DomainError('DRAFT_TOO_LONG', `Draft exceeds ${MAX_DRAFT_LENGTH} characters`, 400);
      }

      const newSource = mode === 'replace' ? text : (doc.source_text ? doc.source_text + '\n' + text : text);
      const newVersion = doc.draft_version + 1;

      updateDoc.run({
        id, docType: doc.doc_type, templateId: doc.template_id,
        sourceText: newSource, draftVersion: newVersion,
        userFields: doc.user_fields, status: 'draft',
        currentVersionId: doc.current_version_id, lastError: doc.last_error, now: now(),
      });

      log?.debug({ documentId: id, mode, added: text.length, total: newSource.length, draftVersion: newVersion }, 'черновик обновлён');
      return toView(getDoc.get(id));
    },

    /**
     * Set document type. After processing, changing type makes version stale.
     *
     * @param {{ platform: string, id: string }} owner
     * @param {string} id - document ID
     * @param {string} typeId - document type ID
     * @returns {object} document view
     */
    setType(owner, id, typeId) {
      const docType = docTypes.get(typeId);
      if (!docType) throw new DomainError('UNKNOWN_TYPE', `Unknown document type: ${typeId}`, 400);

      const doc = getDocByOwner.get(id, owner.platform, owner.id);
      ensureOwner(doc, owner);

      // After processing, changing type makes version stale
      const currentVersionId = doc.status === 'processed' ? null : doc.current_version_id;

      updateDoc.run({
        id, docType: typeId, templateId: doc.template_id,
        sourceText: doc.source_text, draftVersion: doc.draft_version,
        userFields: doc.user_fields, status: 'draft',
        currentVersionId, lastError: null, now: now(),
      });

      log?.debug({ documentId: id, docType: typeId }, 'выбран тип документа');
      return toView(getDoc.get(id));
    },

    /**
     * Set template.
     *
     * @param {{ platform: string, id: string }} owner
     * @param {string} id - document ID
     * @param {string} templateId - template ID
     * @returns {object} document view
     */
    setTemplate(owner, id, templateId) {
      const { template } = templates.get(templateId);
      if (!template) throw new DomainError('UNKNOWN_TEMPLATE', `Unknown template: ${templateId}`, 400);

      const doc = getDocByOwner.get(id, owner.platform, owner.id);
      ensureOwner(doc, owner);

      updateDoc.run({
        id, docType: doc.doc_type, templateId,
        sourceText: doc.source_text, draftVersion: doc.draft_version,
        userFields: doc.user_fields, status: doc.status,
        currentVersionId: doc.current_version_id, lastError: null, now: now(),
      });

      log?.debug({ documentId: id, templateId }, 'выбран шаблон');
      return toView(getDoc.get(id));
    },

    /**
     * Start AI processing — enqueues a job and sets status to 'processing'.
     * Uses idempotent key to prevent duplicate processing.
     *
     * @param {{ platform: string, id: string }} owner
     * @param {string} id - document ID
     * @returns {{ job: object, reused: boolean }}
     */
    startProcessing(owner, id) {
      const doc = getDocByOwner.get(id, owner.platform, owner.id);
      ensureOwner(doc, owner);

      if (!doc.source_text) throw new DomainError('DRAFT_EMPTY', 'No draft text', 400);
      if (!doc.doc_type) throw new DomainError('VALIDATION_ERROR', 'No document type', 400);
      if (!doc.template_id) throw new DomainError('VALIDATION_ERROR', 'No template selected', 400);

      const key = `process:${id}:${doc.draft_version}:${doc.doc_type}`;
      const { job, reused } = queue.enqueue({
        kind: 'process',
        key,
        documentId: id,
        payload: { documentId: id, draftVersion: doc.draft_version, docType: doc.doc_type },
      });

      updateDoc.run({
        id, docType: doc.doc_type, templateId: doc.template_id,
        sourceText: doc.source_text, draftVersion: doc.draft_version,
        userFields: doc.user_fields, status: 'processing',
        currentVersionId: doc.current_version_id, lastError: null, now: now(),
      });

      log?.debug({ documentId: id, jobId: job?.id, reused, draftVersion: doc.draft_version, docType: doc.doc_type, draftLength: doc.source_text.length }, 'обработка ИИ поставлена в очередь');
      return { job, reused };
    },

    /**
     * Retry processing from ai_failed status.
     * Increments attempt counter in the job key for uniqueness.
     *
     * @param {{ platform: string, id: string }} owner
     * @param {string} id - document ID
     * @returns {{ job: object, reused: boolean }}
     */
    retryProcessing(owner, id) {
      const doc = getDocByOwner.get(id, owner.platform, owner.id);
      ensureOwner(doc, owner);

      if (doc.status !== 'ai_failed') {
        throw new DomainError('VALIDATION_ERROR', 'Can only retry from ai_failed status', 400);
      }

      const attempt = (doc.last_error?.match(/attempt (\d+)/)?.[1] || 0) + 1;
      const key = `process:${id}:${doc.draft_version}:${doc.doc_type}:${attempt}`;

      const { job, reused } = queue.enqueue({
        kind: 'process',
        key,
        documentId: id,
        payload: { documentId: id, draftVersion: doc.draft_version, docType: doc.doc_type },
      });

      updateDoc.run({
        id, docType: doc.doc_type, templateId: doc.template_id,
        sourceText: doc.source_text, draftVersion: doc.draft_version,
        userFields: doc.user_fields, status: 'processing',
        currentVersionId: doc.current_version_id, lastError: null, now: now(),
      });

      log?.debug({ documentId: id, jobId: job?.id, reused, draftVersion: doc.draft_version, docType: doc.doc_type, draftLength: doc.source_text.length }, 'обработка ИИ поставлена в очередь');
      return { job, reused };
    },

    /**
     * Set a field value (or null to leave empty).
     * Truncates to 300 chars to prevent abuse.
     *
     * @param {{ platform: string, id: string }} owner
     * @param {string} id - document ID
     * @param {string} key - field key
     * @param {string|null} value - field value or null
     * @returns {object} document view
     */
    setField(owner, id, key, value) {
      const doc = getDocByOwner.get(id, owner.platform, owner.id);
      ensureOwner(doc, owner);

      const fields = JSON.parse(doc.user_fields || '{}');
      // Truncate to 300 chars
      fields[key] = value !== null ? normalizeRussianRequisite(key, String(value)).slice(0, 300) : null;

      updateDoc.run({
        id, docType: doc.doc_type, templateId: doc.template_id,
        sourceText: doc.source_text, draftVersion: doc.draft_version,
        userFields: JSON.stringify(fields), status: doc.status,
        currentVersionId: doc.current_version_id, lastError: null, now: now(),
      });

      return toView(getDoc.get(id));
    },

    /**
     * Set manual text (user edited the result directly).
     * Creates a new version with kind='manual' and marks document as processed.
     *
     * @param {{ platform: string, id: string }} owner
     * @param {string} id - document ID
     * @param {{ title: string, body: string[] }} content
     * @returns {object} document view
     */
    setManualText(owner, id, { title, body }) {
      const doc = getDocByOwner.get(id, owner.platform, owner.id);
      ensureOwner(doc, owner);

      // A text edit changes only the paragraphs: the title and the requisites found by the AI
      // stay from the version being edited, otherwise the DOCX loses addressee/author/subject.
      const previous = doc.current_version_id ? getVersion.get(doc.current_version_id) : null;
      const cleanTitle = title ? stripMarkup(title) : '';
      const keepTitle = !cleanTitle || /^документ$/i.test(cleanTitle);
      const cleanBody = (body || []).map(stripMarkup).filter(Boolean);

      const versionId = crypto.randomUUID();
      insertVersion.run({
        id: versionId, documentId: id, draftVersion: doc.draft_version,
        docType: doc.doc_type, kind: 'manual',
        title: keepTitle ? (previous?.title ?? cleanTitle) : cleanTitle,
        body: JSON.stringify(cleanBody), aiFields: previous?.ai_fields || '{}',
        changes: '[]', warnings: '[]', now: now(),
      });

      updateDoc.run({
        id, docType: doc.doc_type, templateId: doc.template_id,
        sourceText: doc.source_text, draftVersion: doc.draft_version,
        userFields: doc.user_fields, status: 'processed',
        currentVersionId: versionId, lastError: null, now: now(),
      });

      return toView(getDoc.get(id));
    },

    /**
     * Save a processed version (called by AI handler).
     * Returns the version ID for later reference.
     *
     * @param {object} params
     * @param {string} params.documentId
     * @param {number} params.draftVersion
     * @param {string} params.docType
     * @param {string} params.kind - 'ai' or 'manual'
     * @param {string|null} params.title
     * @param {string[]} params.body
     * @param {object} params.aiFields
     * @param {string[]} params.changes
     * @param {string[]} params.warnings
     * @returns {string} version ID
     */
    saveVersion({ documentId, draftVersion, docType, kind, title, body, aiFields, changes, warnings }) {
      const versionId = crypto.randomUUID();
      insertVersion.run({
        id: versionId, documentId, draftVersion, docType, kind, title,
        body: JSON.stringify(body), aiFields: JSON.stringify(aiFields),
        changes: JSON.stringify(changes), warnings: JSON.stringify(warnings), now: now(),
      });
      return versionId;
    },

    /**
     * Mark document as processed (called by AI handler).
     * Updates current_version_id to the latest version for this document.
     * No-op if document doesn't exist (safe for race conditions).
     *
     * @param {string} documentId
     */
    /**
     * Mark a document as failed after the AI could not process it (all attempts used).
     * The draft stays untouched, so the user can retry via retryProcessing().
     *
     * @param {string} documentId
     * @param {string} reason - message shown in the document view
     */
    markFailed(documentId, reason) {
      const doc = getDoc.get(documentId);
      if (!doc) return;
      updateDoc.run({
        id: documentId, docType: doc.doc_type, templateId: doc.template_id,
        sourceText: doc.source_text, draftVersion: doc.draft_version,
        userFields: doc.user_fields, status: 'ai_failed',
        currentVersionId: doc.current_version_id, lastError: String(reason).slice(0, 500), now: now(),
      });
    },

    markProcessed(documentId) {
      const doc = getDoc.get(documentId);
      if (!doc) return;

      // Find the latest version for this document
      const latestVersion = db.prepare(
        'SELECT id FROM versions WHERE document_id = ? ORDER BY created_at DESC LIMIT 1'
      ).get(documentId);

      updateDoc.run({
        id: documentId, docType: doc.doc_type, templateId: doc.template_id,
        sourceText: doc.source_text, draftVersion: doc.draft_version,
        userFields: doc.user_fields, status: 'processed',
        currentVersionId: latestVersion?.id || doc.current_version_id, lastError: null, now: now(),
      });
    },

    /**
     * Render document to DOCX file.
     * Uses file caching: same (version_id, template_id, fields_hash) → reuse.
     *
     * @param {{ platform: string, id: string }} owner
     * @param {string} id - document ID
     * @returns {Promise<{ file: object, fallback: string|null, placeholders: string[] }>}
     */
    async render(owner, id) {
      const doc = getDocByOwner.get(id, owner.platform, owner.id);
      ensureOwner(doc, owner);

      if (!doc.current_version_id) {
        throw new DomainError('NOT_READY', 'No processed version available', 409);
      }

      const version = getVersion.get(doc.current_version_id);
      if (!version) {
        throw new DomainError('NOT_READY', 'Version not found', 409);
      }

      // Check staleness
      if (version.draft_version !== doc.draft_version) {
        throw new DomainError('NOT_READY', 'Version is stale — reprocess required', 409);
      }

      const docType = docTypes.get(doc.doc_type);
      const { template, fallback } = templates.get(doc.template_id);

      // Requisites for the file: user answers > AI values > auto (date) > template.
      // Everything left empty becomes a highlighted [Label] placeholder inside the DOCX.
      const { values, placeholders } = mergeRequisites({
        docType,
        template,
        aiFields: JSON.parse(version.ai_fields || '{}'),
        title: version.title,
        userFields: JSON.parse(doc.user_fields || '{}'),
        today: new Date().toISOString().slice(0, 10),
      });
      const model = {
        docType,
        template,
        values,
        title: version.title,
        body: JSON.parse(version.body || '[]'),
      };

      const buffer = await renderDocx(model);
      // Кеш файла: одна и та же версия + шаблон + значения реквизитов дают тот же файл.
      const fieldsHash = crypto.createHash('sha256')
        .update(JSON.stringify(Object.entries(values).map(([key, item]) => [key, item?.value ?? null]).sort()))
        .digest('hex')
        .slice(0, 16);

      const filename = `${docType.name}_${new Date().toISOString().slice(0, 10)}_${id.slice(0, 8)}.docx`;

      // Check if file already cached
      const existing = findFile.get(version.id, doc.template_id, fieldsHash);
      if (existing) {
        log?.debug({ documentId: id, fileId: existing.id, templateId: doc.template_id }, 'DOCX взят из кеша');
        return { file: existing, fallback: fallback?.requestedId || null, placeholders: JSON.parse(existing.placeholders || '[]') };
      }

      // Save new file
      const saved = fileStorage.save(buffer, filename);
      const fileId = crypto.randomUUID();
      insertFile.run({
        id: fileId, documentId: id, versionId: version.id,
        templateId: doc.template_id, fieldsHash,
        path: saved.path, filename,
        placeholders: JSON.stringify(placeholders),
        now: now(),
      });

      log?.debug({
        documentId: id, fileId, filename, bytes: buffer.length,
        templateId: doc.template_id, fallback: fallback?.requestedId ?? null,
        placeholders: placeholders.map((p) => p.key ?? p),
      }, 'DOCX собран');
      return { file: getFile.get(fileId), fallback: fallback?.requestedId || null, placeholders };
    },

    /**
     * Get document view (with ownership check).
     *
     * @param {{ platform: string, id: string }} owner
     * @param {string} id - document ID
     * @returns {object} document view
     */
    get(owner, id) {
      const doc = getDocByOwner.get(id, owner.platform, owner.id);
      ensureOwner(doc, owner);
      return toView(doc);
    },

    /** List immutable processing versions for the history panel. */
    listVersions(owner, id) {
      const doc = getDocByOwner.get(id, owner.platform, owner.id);
      ensureOwner(doc, owner);
      return db.prepare('SELECT * FROM versions WHERE document_id = ? ORDER BY created_at DESC').all(id).map((version) => ({
        id: version.id,
        documentId: version.document_id,
        draftVersion: version.draft_version,
        docType: version.doc_type,
        kind: version.kind,
        title: version.title,
        body: JSON.parse(version.body || '[]'),
        aiFields: JSON.parse(version.ai_fields || '{}'),
        changes: JSON.parse(version.changes || '[]'),
        warnings: JSON.parse(version.warnings || '[]'),
        createdAt: version.created_at,
        current: doc.current_version_id === version.id,
      }));
    },

    /** Restore a prior version as a new immutable version so rollback is auditable. */
    restoreVersion(owner, id, versionId) {
      const doc = getDocByOwner.get(id, owner.platform, owner.id);
      ensureOwner(doc, owner);
      const previous = getVersion.get(versionId);
      if (!previous || previous.document_id !== id) throw new DomainError('NOT_FOUND', 'Version not found', 404);
      const restoredId = crypto.randomUUID();
      insertVersion.run({
        id: restoredId, documentId: id, draftVersion: doc.draft_version,
        docType: doc.doc_type, kind: 'restore', title: previous.title,
        body: previous.body, aiFields: previous.ai_fields,
        changes: JSON.stringify([`Восстановлена версия от ${previous.created_at}`]),
        warnings: previous.warnings || '[]', now: now(),
      });
      updateDoc.run({
        id, docType: doc.doc_type, templateId: doc.template_id,
        sourceText: doc.source_text, draftVersion: doc.draft_version,
        userFields: doc.user_fields, status: 'processed',
        currentVersionId: restoredId, lastError: null, now: now(),
      });
      return toView(getDoc.get(id));
    },

    /**
     * Get a rendered file after checking the document owner.
     * File IDs are opaque UUIDs, but opacity is not an authorization boundary.
     */
    getFile(owner, fileId) {
      const file = getFile.get(fileId);
      if (!file) throw new DomainError('NOT_FOUND', 'File not found', 404);
      const doc = getDocByOwner.get(file.document_id, owner.platform, owner.id);
      ensureOwner(doc, owner);
      return file;
    },

    /**
     * List documents for owner with pagination.
     *
     * @param {{ platform: string, id: string }} owner
     * @param {{ status?: string, limit?: number, offset?: number }} options
     * @returns {{ documents: object[], total: number }}
     */
    list(owner, { status, limit = 20, offset = 0 } = {}) {
      let docs;
      let total;
      if (status) {
        docs = db.prepare(`
          SELECT * FROM documents WHERE owner_platform = ? AND owner_id = ? AND status = ?
          ORDER BY updated_at DESC LIMIT ? OFFSET ?
        `).all(owner.platform, owner.id, status, limit, offset);
        total = db.prepare(`
          SELECT COUNT(*) as total FROM documents WHERE owner_platform = ? AND owner_id = ? AND status = ?
        `).get(owner.platform, owner.id, status).total;
      } else {
        docs = listDocs.all(owner.platform, owner.id, limit, offset);
        total = countDocs.get(owner.platform, owner.id).total;
      }
      return { documents: docs.map(toView), total };
    },

    /**
     * Delete document and all related data (cascade).
     * Order: deliveries → files → versions → document.
     *
     * @param {{ platform: string, id: string }} owner
     * @param {string} id - document ID
     */
    remove(owner, id) {
      const doc = getDocByOwner.get(id, owner.platform, owner.id);
      ensureOwner(doc, owner);

      // Delete in order: deliveries → files → versions → document
      deleteDeliveries.run(id);
      // Also delete physical files
      const files = db.prepare('SELECT path FROM files WHERE document_id = ?').all(id);
      for (const f of files) {
        try { fileStorage.remove(f.id); } catch {}
      }
      deleteFiles.run(id);
      deleteVersions.run(id);
      deleteDoc.run(id, owner.platform, owner.id);
    },

    /**
     * Get internal document (for handlers — no owner check).
     * Used by AI processing handlers that operate on documentId directly.
     *
     * @param {string} documentId
     * @returns {object|null} raw DB row
     */
    getInternal(documentId) {
      return getDoc.get(documentId) || null;
    },

    /**
     * Write to processing log.
     * Used by handlers to record pipeline stages.
     *
     * @param {{ documentId: string, jobId?: string, stage: string, data: object }} params
     */
    logProcessing({ documentId, jobId, stage, data }) {
      insertLog.run({
        documentId, jobId: jobId || null, stage,
        data: JSON.stringify(data), now: now(),
      });
    },
  };
}
