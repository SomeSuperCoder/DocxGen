import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadDocTypes, DocTypeSchema } from '../../src/catalog/docTypes.js';
import { loadTemplates, TemplateSchema } from '../../src/catalog/templates.js';
import { FALLBACK_TEMPLATE } from '../../src/catalog/fallbackTemplate.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const DOC_TYPES_DIR = path.join(ROOT, 'config', 'doc-types');
const TEMPLATES_DIR = path.join(ROOT, 'config', 'templates');

// ── Doc type schema validation ───────────────────────────────────────────────

describe('DocTypeSchema', () => {
  const files = ['memo.json', 'report.json', 'reference.json', 'letter.json', 'explanatory-note.json'];

  for (const file of files) {
    it(`validates ${file}`, () => {
      const raw = JSON.parse(fs.readFileSync(path.join(DOC_TYPES_DIR, file), 'utf8'));
      const result = DocTypeSchema.safeParse(raw);
      expect(result.success).toBe(true);
    });
  }
});

// ── Template schema validation ───────────────────────────────────────────────

describe('TemplateSchema', () => {
  const files = ['classic.json', 'modern.json'];

  for (const file of files) {
    it(`validates ${file}`, () => {
      const raw = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, file), 'utf8'));
      const result = TemplateSchema.safeParse(raw);
      expect(result.success).toBe(true);
    });
  }
});

// ── loadDocTypes ─────────────────────────────────────────────────────────────

describe('loadDocTypes', () => {
  let catalog;

  beforeAll(() => {
    catalog = loadDocTypes(DOC_TYPES_DIR);
  });

  it('returns a Map with correct IDs', () => {
    const list = catalog.list();
    expect(list.length).toBe(9);
    const ids = list.map((d) => d.id).sort();
    expect(ids).toEqual(['act', 'explanatory-note', 'letter', 'memo', 'order', 'protocol', 'reference', 'report', 'statement']);
  });

  it('get() returns the correct doc type', () => {
    const memo = catalog.get('memo');
    expect(memo).not.toBeNull();
    expect(memo.id).toBe('memo');
    expect(memo.name).toBe('Служебная записка');
  });

  it('get() returns null for unknown ID', () => {
    expect(catalog.get('unknown')).toBeNull();
  });
});

// ── loadTemplates ────────────────────────────────────────────────────────────

describe('loadTemplates', () => {
  let catalog;
  const log = { error: () => {}, warn: () => {}, info: () => {} };

  beforeAll(() => {
    catalog = loadTemplates(TEMPLATES_DIR, log);
  });

  it('returns a Map with correct IDs', () => {
    const list = catalog.list();
    expect(list.length).toBeGreaterThanOrEqual(2);
    const ids = list.map((t) => t.id).sort();
    expect(ids).toContain('classic');
    expect(ids).toContain('modern');
  });

  it('get() returns template with no fallback for valid ID', () => {
    const result = catalog.get('classic');
    expect(result.fallback).toBeNull();
    expect(result.template.id).toBe('classic');
  });

  it('get() returns fallback for missing ID', () => {
    const result = catalog.get('nonexistent');
    expect(result.fallback).not.toBeNull();
    expect(result.fallback.requestedId).toBe('nonexistent');
    expect(result.template.id).toBe('classic'); // fallback is classic
  });
});

// ── Corrupted JSON handling ──────────────────────────────────────────────────

describe('corrupted JSON handling', () => {
  let tmpDir;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-test-'));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loadDocTypes skips corrupted JSON files', () => {
    fs.writeFileSync(path.join(tmpDir, 'bad.json'), '{ not valid json !!!');
    fs.writeFileSync(
      path.join(tmpDir, 'good.json'),
      JSON.stringify({
        id: 'test',
        name: 'Test',
        hint: 'Test hint',
        docTitle: 'TEST',
        layout: ['body'],
        structureHint: 'Test structure',
        fields: [],
      }),
    );

    const log = { error: () => {}, warn: () => {}, info: () => {} };
    const catalog = loadDocTypes(tmpDir, log);
    expect(catalog.list().length).toBe(1);
    expect(catalog.get('test')).not.toBeNull();
  });

  it('loadTemplates skips corrupted JSON and returns fallback for missing', () => {
    fs.writeFileSync(path.join(tmpDir, 'broken.json'), 'THIS IS NOT JSON');
    // No valid templates → get() returns fallback
    const log = { error: () => {}, warn: () => {}, info: () => {} };
    const catalog = loadTemplates(tmpDir, log);
    expect(catalog.list().length).toBe(0);
    const result = catalog.get('anything');
    expect(result.template.id).toBe('classic'); // fallback
    expect(result.fallback).not.toBeNull();
  });
});

// ── Fallback template ────────────────────────────────────────────────────────

describe('FALLBACK_TEMPLATE', () => {
  it('matches the classic template structure', () => {
    const result = TemplateSchema.safeParse(FALLBACK_TEMPLATE);
    expect(result.success).toBe(true);
  });

  it('has id "classic"', () => {
    expect(FALLBACK_TEMPLATE.id).toBe('classic');
  });
});
