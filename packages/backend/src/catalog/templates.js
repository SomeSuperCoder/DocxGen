import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { FALLBACK_TEMPLATE } from './fallbackTemplate.js';

// ── Zod schema ───────────────────────────────────────────────────────────────

export const TemplateSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  description: z.string().min(1),
  preview: z.string().nullable().optional(),
  organization: z.object({
    name: z.string(),
    address: z.string().optional(),
    phone: z.string().optional(),
  }),
  page: z.object({
    marginsMm: z.object({
      top: z.number(),
      right: z.number(),
      bottom: z.number(),
      left: z.number(),
    }),
  }),
  font: z.object({
    family: z.string(),
    sizePt: z.number().min(8).max(20),
  }),
  paragraph: z.object({
    lineSpacing: z.number().min(1).max(3),
    firstLineIndentMm: z.number().min(0),
    align: z.enum(['left', 'justify', 'center', 'right']),
    spaceAfterPt: z.number().min(0),
  }),
  header: z.object({
    pageNumber: z.enum(['none', 'center', 'right']),
    firstPage: z.boolean(),
    text: z.string().nullable(),
  }),
  footer: z.object({
    text: z.string().nullable(),
    pageNumber: z.enum(['none', 'center', 'right', 'nOfM']).optional(),
  }),
  blocks: z.record(z.string(), z.record(z.string(), z.unknown())),
  placeholder: z.object({
    format: z.string().includes('{label}'),
    highlight: z.string().nullable(),
  }),
  autoFill: z.object({ date: z.boolean() }),
  dateFormat: z.string(),
});

// ── Loader ───────────────────────────────────────────────────────────────────

/**
 * Load and validate template definitions from a directory of JSON files.
 * If the requested template is missing or invalid, get() returns the fallback.
 *
 * @param {string} dir  absolute path to the directory containing *.json files
 * @param {object} log  pino-compatible logger (required — logs fallback usage)
 * @returns {{ list: () => Template[], get: (id: string) => { template: Template, fallback: { requestedId: string, reason: string } | null } }}
 */
export function loadTemplates(dir, log) {
  const valid = new Map();

  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      const parsed = TemplateSchema.parse(raw);
      valid.set(parsed.id, parsed);
    } catch (err) {
      log.error({ file, err: err.message }, 'template rejected');
    }
  }

  // Warn if fewer than 2 valid templates — server will work but on fallback only
  if (valid.size < 2) {
    log.warn({ count: valid.size }, 'less than 2 valid templates — server will rely on fallback');
  }

  return {
    list: () => [...valid.values()],
    /** Register a validated user template at runtime (DOCX bланк import). */
    register(template) {
      const parsed = TemplateSchema.parse(template);
      valid.set(parsed.id, parsed);
      return parsed;
    },
    get(id) {
      const template = valid.get(id);
      if (template) {
        return { template, fallback: null };
      }
      // Fallback: return the hardcoded classic template with metadata about the miss
      log.warn({ requestedId: id }, 'template not found, using fallback');
      return {
        template: FALLBACK_TEMPLATE,
        fallback: { requestedId: id, reason: 'missing_or_invalid' },
      };
    },
  };
}
