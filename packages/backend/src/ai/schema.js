import { z } from 'zod';

// ── Field value schema ───────────────────────────────────────────────────────
// Each extracted field has a `value` (normalized) and a `quote` (verbatim snippet from draft).
// null means "not found / could not extract".

// Derived fields (Тема) have no verbatim source, so quote may be null; an empty value means "not found".
const FieldValue = z.preprocess(
  (raw) => (raw && typeof raw === 'object' && !String(raw.value ?? '').trim() ? null : raw),
  z.object({
    value: z.string().trim().min(1),
    quote: z.string().trim().nullish().transform((q) => q || null),
  }).nullable(),
);

// ── Full AI result schema ────────────────────────────────────────────────────
// title: nullable — AI may leave it unchanged or return null
// body: array of paragraphs (non-empty, trimmed, max 50 paragraphs × 5000 chars each)
// fields: record of fieldKey → FieldValue | null
// changes: human-readable list of what was modified (max 10 to prevent noise)

export const AiResultSchema = z.object({
  title: z.string().trim().min(1).nullable(),
  body: z.array(z.string().trim().min(1).max(5000)).min(1).max(50),
  fields: z.record(z.string(), FieldValue).default({}),
  changes: z.array(z.string()).max(10).default([]),
});

/**
 * Extract JSON from AI response — handles markdown fences and surrounding text.
 * Strategy 1: try to extract from markdown code fence (```json ... ```).
 * Strategy 2: fall back to raw JSON extraction (find first { to last }).
 * @param {string} raw
 * @returns {object}
 */
export function extractJson(raw) {
  // Strategy 1: try to extract from markdown code fence
  const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    const inner = fenceMatch[1].trim();
    const start = inner.indexOf('{');
    const end = inner.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try { return JSON.parse(inner.slice(start, end + 1)); } catch {}
    }
  }

  // Strategy 2: find raw JSON in text
  const text = raw.replace(/```(?:json)?/gi, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON object in AI response');
  return JSON.parse(text.slice(start, end + 1));
}
