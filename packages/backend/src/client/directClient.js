/**
 * Direct (in-process) document repository for the dialog flow.
 *
 * Implements the same owner-bound interface as createDocumentServiceClient().withOwner(),
 * but calls the in-process documentService instead of HTTP. Used by createRuntime
 * (monolith mode / tests) where the AI worker runs in the same process — no HTTP
 * round-trip and no server on :3001 required.
 *
 * Split mode keeps the REST client (see *-bot-service.js); this module keeps the
 * flow transport-agnostic.
 *
 * @param {object} documentService — createDocumentService({...})
 * @returns {{ withOwner: function }}
 */
export function createDirectDocuments(documentService) {
  return {
    withOwner(owner) {
      return {
        getDocuments: (opts = {}) => documentService.list(owner, opts),

        getVersions: (id) => ({ versions: documentService.listVersions(owner, id) }),
        restoreVersion: (id, versionId) => documentService.restoreVersion(owner, id, versionId),

        getDocument: (id) => documentService.get(owner, id),

        createDocument: ({ sourceText, docType, templateId } = {}) => {
          const doc = documentService.create(owner);
          if (docType) documentService.setType(owner, doc.id, docType);
          if (templateId) documentService.setTemplate(owner, doc.id, templateId);
          if (sourceText) documentService.setDraft(owner, doc.id, sourceText, { mode: 'replace' });
          return documentService.get(owner, doc.id);
        },

        updateDocument: (id, { sourceText, docType, templateId } = {}) => {
          if (docType !== undefined) documentService.setType(owner, id, docType);
          if (templateId !== undefined) documentService.setTemplate(owner, id, templateId);
          if (sourceText !== undefined) documentService.setDraft(owner, id, sourceText, { mode: 'replace' });
          return documentService.get(owner, id);
        },

        setDraft: (id, text, { mode = 'append' } = {}) =>
          documentService.setDraft(owner, id, text, { mode }),

        deleteDocument: (id) => documentService.remove(owner, id),

        processDocument: (id) => documentService.startProcessing(owner, id),

        retryProcessing: (id) => documentService.retryProcessing(owner, id),

        setFields: (id, fields) => {
          for (const [key, value] of Object.entries(fields ?? {})) {
            documentService.setField(owner, id, key, value);
          }
          return documentService.get(owner, id);
        },

        setManualText: (id, { title, body }) =>
          documentService.setManualText(owner, id, { title, body }),

        renderDocument: (id) => documentService.render(owner, id),
      };
    },
  };
}
