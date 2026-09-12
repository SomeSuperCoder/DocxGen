import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

// ── Zod schemas ──────────────────────────────────────────────────────────────

export const FieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  kind: z.enum(['extract', 'derived', 'auto', 'template', 'registry']),
  required: z.boolean(),
  question: z.string().optional(),
  example: z.string().optional(),
});

export const DocTypeSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  hint: z.string().min(1),
  docTitle: z.string().nullable(),
  layout: z.array(z.union([z.string(), z.array(z.string())])),
  structureHint: z.string().min(1),
  fields: z.array(FieldSchema),
});

// ── Loader ───────────────────────────────────────────────────────────────────

/**
 * Load and validate document type definitions from a directory of JSON files.
 * @param {string} dir  absolute path to the directory containing *.json files
 * @param {object} [log]  pino-compatible logger (optional)
 * @returns {{ list: () => DocType[], get: (id: string) => DocType | null }}
 */
export function loadDocTypes(dir, log) {
  const valid = new Map();

  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      const parsed = DocTypeSchema.parse(raw);
      valid.set(parsed.id, parsed);
    } catch (err) {
      log?.error({ file, err: err.message }, 'doc type rejected');
    }
  }

  return {
    list: () => [...valid.values()],
    get(id) {
      return valid.get(id) ?? null;
    },
  };
}
