/**
 * In-process document client used by the bot adapters.
 *
 * The adapters live in the same backend process as the document service. This
 * facade keeps the flow independent from the transport: production adapters
 * call the core service directly, while external integrations may still use
 * documentServiceClient.js over HTTP.
 */

/**
 * @param {{ documentService: object, docTypes: object, templates: object, faultManager?: object }} deps
 * @param {{ platform: string, id: string }} [owner]
 */
export function createLocalDocumentServiceClient(deps, owner = null) {
  const { documentService, docTypes, templates, faultManager } = deps;

  const withOwner = (nextOwner) => createLocalDocumentServiceClient(deps, nextOwner);
  const requireOwner = () => {
    if (!owner) throw new Error('Document client requires an owner');
    return owner;
  };

  return {
    withOwner,

    getCatalog() {
      return {
        docTypes: docTypes.list().map(({ id, name, hint, fields }) => ({ id, name, hint, fields })),
        templates: templates.list().map(({ id, name, description, preview }) => ({ id, name, description, preview: preview || null })),
      };
    },

    getDocuments(options = {}) {
      return documentService.list(requireOwner(), options);
    },

    getVersions(id) {
      return { versions: documentService.listVersions(requireOwner(), id) };
    },

    restoreVersion(id, versionId) {
      return documentService.restoreVersion(requireOwner(), id, versionId);
    },

    getDocument(id) {
      return documentService.get(requireOwner(), id);
    },

    createDocument({ sourceText, docType, templateId } = {}) {
      const currentOwner = requireOwner();
      let doc = documentService.create(currentOwner);
      if (docType) doc = documentService.setType(currentOwner, doc.id, docType);
      if (templateId) doc = documentService.setTemplate(currentOwner, doc.id, templateId);
      if (sourceText) doc = documentService.setDraft(currentOwner, doc.id, sourceText, { mode: 'replace' });
      return doc;
    },

    armAiFault() {
      const currentOwner = requireOwner();
      faultManager?.armOnce(`${currentOwner.platform}:${currentOwner.id}`);
      return { armed: true };
    },

    updateDocument(id, { sourceText, docType, templateId } = {}) {
      const currentOwner = requireOwner();
      if (docType !== undefined) documentService.setType(currentOwner, id, docType);
      if (templateId !== undefined) documentService.setTemplate(currentOwner, id, templateId);
      if (sourceText !== undefined) documentService.setDraft(currentOwner, id, sourceText, { mode: 'replace' });
      return documentService.get(currentOwner, id);
    },

    setDraft(id, text, { mode = 'append' } = {}) {
      return documentService.setDraft(requireOwner(), id, text, { mode });
    },

    deleteDocument(id) {
      documentService.remove(requireOwner(), id);
      return null;
    },

    processDocument(id) {
      const result = documentService.startProcessing(requireOwner(), id);
      return { jobId: result.job.id, reused: result.reused };
    },

    retryProcessing(id) {
      const result = documentService.retryProcessing(requireOwner(), id);
      return { jobId: result.job.id, reused: result.reused };
    },

    setFields(id, fields) {
      const currentOwner = requireOwner();
      for (const [key, value] of Object.entries(fields || {})) {
        documentService.setField(currentOwner, id, key, value);
      }
      return documentService.get(currentOwner, id);
    },

    setManualText(id, content) {
      return documentService.setManualText(requireOwner(), id, content);
    },

    async renderDocument(id) {
      const result = await documentService.render(requireOwner(), id);
      return {
        file: result.file,
        fileId: result.file.id,
        filename: result.file.filename,
        placeholders: result.placeholders,
        fallback: result.fallback,
      };
    },
  };
}
