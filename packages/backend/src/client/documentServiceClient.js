/**
 * REST client for the Document Service.
 *
 * Wraps all Document Service API calls via HTTP fetch.
 * Each method maps to one API endpoint, handles request/response
 * serialization, and throws on non-2xx responses.
 *
 * Design decisions:
 * - Single Responsibility: one client per service, one method per endpoint
 * - Dependency Inversion: receives baseUrl/apiKey via constructor, never imports env
 * - Explicit error handling: throws with structured error on non-2xx
 * - Timeout support: configurable per-request timeout via AbortSignal
 * - Owner support: sends X-Owner-Platform/X-Owner-Id headers for per-user ownership
 *
 * @param {{ baseUrl: string, apiKey: string, owner?: { platform: string, id: string }, timeoutMs?: number }} config
 */
export function createDocumentServiceClient({ baseUrl, apiKey, owner, timeoutMs = 30_000 } = {}) {
  // The repository runs one backend process. A separate URL can still be
  // supplied for external deployments, but the local default is the public API.
  const base = (baseUrl || 'http://localhost:3000').replace(/\/+$/, '');

  /**
   * Core fetch wrapper — adds API key header, handles errors, parses JSON.
   * @param {string} path - URL path (e.g. '/api/documents')
   * @param {RequestInit} [options]
   * @returns {Promise<any>}
   */
  async function request(path, options = {}) {
    const url = `${base}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { 'X-API-Key': apiKey } : {}),
          // Owner headers: identify the user on whose behalf the request is made.
          // The Document Service API extracts these from headers when API key auth is used,
          // instead of relying on session cookies (which bots don't send).
          ...(owner ? { 'X-Owner-Platform': owner.platform, 'X-Owner-Id': owner.id } : {}),
          ...options.headers,
        },
      });

      // 204 No Content — return null (used by DELETE)
      if (res.status === 204) return null;

      const body = await res.json().catch(() => null);

      if (!res.ok) {
        const message = body?.error?.message || `HTTP ${res.status}`;
        const code = body?.error?.code || 'HTTP_ERROR';
        const err = new Error(message);
        err.code = code;
        err.status = res.status;
        throw err;
      }

      return body;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    /**
     * Create a new client bound to a specific owner.
     * All subsequent requests will carry the owner's headers.
     * @param {{ platform: string, id: string }} newOwner
     * @returns {object} new client instance with owner set
     */
    withOwner(newOwner) {
      return createDocumentServiceClient({ baseUrl, apiKey, owner: newOwner, timeoutMs });
    },

    // ── Catalog ────────────────────────────────────────────────────────────

    /** Get available document types and templates. */
    async getCatalog() {
      return request('/api/catalog');
    },

    // ── Documents CRUD ─────────────────────────────────────────────────────

    /** List documents with optional filters. */
    async getDocuments({ status, limit, offset } = {}) {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (limit !== undefined) params.set('limit', String(limit));
      if (offset !== undefined) params.set('offset', String(offset));
      const qs = params.toString();
      return request(`/api/documents${qs ? `?${qs}` : ''}`);
    },

    async getVersions(id) {
      return request(`/api/documents/${encodeURIComponent(id)}/versions`);
    },

    async restoreVersion(id, versionId) {
      return request(`/api/documents/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}/restore`, { method: 'POST' });
    },

    /** Get a single document by ID. */
    async getDocument(id) {
      return request(`/api/documents/${encodeURIComponent(id)}`);
    },

    /** Create a new document. */
    async createDocument({ sourceText, docType, templateId } = {}) {
      return request('/api/documents', {
        method: 'POST',
        body: JSON.stringify({ sourceText, docType, templateId }),
      });
    },

    /** Взвести имитацию сбоя ИИ для текущего владельца (/ai_fail, сценарий 6). */
    async armAiFault() {
      return request('/api/debug/ai-fault', { method: 'POST' });
    },

    /** Update a document (type, template, or draft text). */
    async updateDocument(id, { sourceText, docType, templateId } = {}) {
      return request(`/api/documents/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ sourceText, docType, templateId }),
      });
    },

    /**
     * Set draft text with append or replace mode.
     * The PATCH endpoint only supports replace, so append requires a GET first.
     * @param {string} id - document ID
     * @param {string} text - new text content
     * @param {{ mode?: 'append' | 'replace' }} options
     * @returns {Promise<object>} updated document view
     */
    async setDraft(id, text, { mode = 'append' } = {}) {
      if (mode === 'replace') {
        return request(`/api/documents/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ sourceText: text }),
        });
      }
      // Append mode: GET current sourceText, concatenate, PATCH
      const doc = await request(`/api/documents/${encodeURIComponent(id)}`);
      const newSource = doc.sourceText ? doc.sourceText + '\n' + text : text;
      return request(`/api/documents/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ sourceText: newSource }),
      });
    },

    /** Delete a document by ID. */
    async deleteDocument(id) {
      return request(`/api/documents/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
    },

    // ── Processing ─────────────────────────────────────────────────────────

    /** Start AI processing for a document. Returns { jobId, reused }. */
    async processDocument(id) {
      return request(`/api/documents/${encodeURIComponent(id)}/process`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
    },

    /** Retry processing from ai_failed status. Maps to same endpoint as processDocument. */
    async retryProcessing(id) {
      return request(`/api/documents/${encodeURIComponent(id)}/retry`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
    },

    // ── Fields ─────────────────────────────────────────────────────────────

    /** Set user-defined fields on a document. */
    async setFields(id, fields) {
      return request(`/api/documents/${encodeURIComponent(id)}/fields`, {
        method: 'PUT',
        body: JSON.stringify(fields),
      });
    },

    // ── Manual Text ────────────────────────────────────────────────────────

    /** Set manual title and body for a document. */
    async setManualText(id, { title, body }) {
      return request(`/api/documents/${encodeURIComponent(id)}/text`, {
        method: 'PUT',
        body: JSON.stringify({ title, body }),
      });
    },

    // ── Render ─────────────────────────────────────────────────────────────

    /** Render a document to DOCX. Returns { fileId, downloadUrl, filename, ... }. */
    async renderDocument(id) {
      return request(`/api/documents/${encodeURIComponent(id)}/render`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
    },

    // ── File Download ──────────────────────────────────────────────────────

    /**
     * Download a rendered file as a Buffer.
     * Unlike other methods, returns raw bytes (not JSON).
     *
     * @param {string} fileId
     * @returns {Promise<{ buffer: Buffer, contentType: string, filename: string }>}
     */
    async downloadFile(fileId) {
      const url = `${base}/api/files/${encodeURIComponent(fileId)}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const res = await fetch(url, {
          signal: controller.signal,
          headers: {
            ...(apiKey ? { 'X-API-Key': apiKey } : {}),
          },
        });

        if (!res.ok) {
          const body = await res.json().catch(() => null);
          const message = body?.error?.message || `HTTP ${res.status}`;
          const code = body?.error?.code || 'HTTP_ERROR';
          const err = new Error(message);
          err.code = code;
          err.status = res.status;
          throw err;
        }

        const arrayBuffer = await res.arrayBuffer();
        return {
          buffer: Buffer.from(arrayBuffer),
          contentType: res.headers.get('content-type') || 'application/octet-stream',
          filename: extractFilename(res.headers.get('content-disposition')),
        };
      } finally {
        clearTimeout(timer);
      }
    },

    // ── Processing Log ─────────────────────────────────────────────────────

    /** Get processing logs for a document. */
    async getProcessingLog(id) {
      return request(`/api/documents/${encodeURIComponent(id)}/log`);
    },
  };
}

/**
 * Extract filename from Content-Disposition header.
 * Handles both `filename="..."` and `filename*=UTF-8''...` formats.
 */
function extractFilename(header) {
  if (!header) return 'download';

  // Try RFC 5987 encoded filename first
  const utf8Match = header.match(/filename\*=UTF-8''(.+)/i);
  if (utf8Match) return decodeURIComponent(utf8Match[1]);

  // Fallback to regular filename
  const match = header.match(/filename="?([^";\n]+)"?/i);
  return match ? match[1].trim() : 'download';
}
