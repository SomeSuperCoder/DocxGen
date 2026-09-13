/**
 * Process document handler — runs AI processing for a queued document.
 *
 * Flow: load document → check staleness → processDraft (AI + validation) →
 * save version → mark processed → emit event for the notifier.
 *
 * Retries: the worker requeues retryable AI errors. The 'document.failed'
 * event is emitted only when no attempts are left — otherwise the user would
 * see an error message and then, seconds later, a successful result.
 *
 * Dependencies are injected (Dependency Inversion):
 *   documentService — document lifecycle
 *   processDraft — AI pipeline (injected for tests)
 *   docTypes — document type catalog (config passed to the AI prompt)
 *   provider — AI provider (openai | opencode | mock)
 *   faultManager — simulated AI outage for scenario 6 (/ai_fail)
 *   log — pino-compatible logger
 */

import { events } from '../../core/events.js';

export function createProcessDocumentHandler({ documentService, processDraft, docTypes, provider, faultManager, log }) {
  return async function processDocument(job) {
    const payload = job.payload ? JSON.parse(job.payload) : {};
    const { documentId, draftVersion, docType } = payload;

    const doc = documentService.getInternal(documentId);
    if (!doc) {
      log.warn({ documentId }, 'document not found, skipping');
      return 'stale';
    }

    // The draft or the type changed after the job was queued — the result would be outdated.
    if (doc.draft_version !== draftVersion || doc.doc_type !== docType) {
      return 'stale';
    }

    const attemptsUsed = (job.attempts ?? 0) + 1 >= (job.max_attempts ?? 1);

    try {
      const result = await processDraft({
        draft: doc.source_text,
        docType: docTypes ? docTypes.get(doc.doc_type) : doc.doc_type_config,
        userFields: JSON.parse(doc.user_fields || '{}'),
        provider,
        faultManager,
        ownerKey: `${doc.owner_platform}:${doc.owner_id}`,
        log,
      });

      documentService.saveVersion({
        documentId,
        draftVersion,
        docType: doc.doc_type,
        kind: 'ai',
        title: result.title,
        body: result.body,
        aiFields: result.aiFields,
        changes: result.changes,
        warnings: result.warnings,
      });
      documentService.markProcessed(documentId);
      events.emit('document.processed', { documentId });
    } catch (err) {
      // The user is told about the failure only when nothing will be retried — otherwise they would
      // see an error and a successful result a few seconds later.
      const finalFailure = attemptsUsed || err.retryable === false;
      log.error({ documentId, error: err.message, finalFailure }, 'processDocument failed');
      if (finalFailure) {
        documentService.markFailed?.(documentId, err.message);
        events.emit('document.failed', { documentId, reason: err.message });
      }
      throw err; // Let the worker decide between retry and permanent failure
    }
  };
}
