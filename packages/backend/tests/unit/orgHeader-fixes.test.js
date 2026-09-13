import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { BLOCKS } from '../../src/docx/blocks.js';

// ── Load config files ────────────────────────────────────────────────────────

const modernTemplate = JSON.parse(
  readFileSync(new URL('../../config/templates/modern.json', import.meta.url), 'utf8'),
);
const classicTemplate = JSON.parse(
  readFileSync(new URL('../../config/templates/classic.json', import.meta.url), 'utf8'),
);

const memoDocType = JSON.parse(
  readFileSync(new URL('../../config/doc-types/memo.json', import.meta.url), 'utf8'),
);
const reportDocType = JSON.parse(
  readFileSync(new URL('../../config/doc-types/report.json', import.meta.url), 'utf8'),
);
const referenceDocType = JSON.parse(
  readFileSync(new URL('../../config/doc-types/reference.json', import.meta.url), 'utf8'),
);
const explanatoryNoteDocType = JSON.parse(
  readFileSync(new URL('../../config/doc-types/explanatory-note.json', import.meta.url), 'utf8'),
);
const letterDocType = JSON.parse(
  readFileSync(new URL('../../config/doc-types/letter.json', import.meta.url), 'utf8'),
);

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal RenderModel for testing block functions. */
function buildModel(overrides = {}) {
  return {
    docType: overrides.docType ?? memoDocType,
    template: overrides.template ?? modernTemplate,
    values: overrides.values ?? {},
    title: overrides.title ?? null,
    body: overrides.body ?? [],
  };
}

/** Extract all text from a Paragraph's root structure. */
function extractParagraphText(paragraph) {
  return paragraph.root
    .filter(item => item.rootKey === 'w:r')
    .map(r => {
      const t = r.root.find(c => c.rootKey === 'w:t');
      return t ? t.root[t.root.length - 1] : '';
    })
    .join('');
}

// ── FIX 1: modern.json orgHeader.show = true ─────────────────────────────────

describe('FIX 1: modern.json orgHeader.show = true', () => {
  it('modern.json blocks.orgHeader.show is true', () => {
    expect(modernTemplate.blocks.orgHeader.show).toBe(true);
  });

  it('orgHeader block is NOT empty when rendering with modern template', () => {
    const model = buildModel({
      template: { ...modernTemplate, organization: { ...modernTemplate.organization, name: 'ООО «Пример»' } },
      values: {
        'Наименование подразделения': { value: null, label: 'Подразделение', source: 'ai' },
      },
    });
    const result = BLOCKS.orgHeader(model);
    expect(result.length).toBeGreaterThan(0);
    // Should produce a Paragraph (the org header)
    expect(result[0].constructor.name).toBe('Paragraph');
  });
});

// ── FIX 2: orgHeader renders subdivision and position ────────────────────────

describe('FIX 2: orgHeader renders subdivision (06); position (07) stays in the signature', () => {
  it('renders subdivision after org name when present', () => {
    const model = buildModel({
      template: classicTemplate,
      values: {
        'Наименование подразделения': { value: 'Отдел закупок', label: 'Подразделение', source: 'ai' },
      },
    });
    const result = BLOCKS.orgHeader(model);
    // One paragraph per requisite line; the template blank has no organization name
    expect(result.length).toBe(1);
    expect(extractParagraphText(result[0])).toBe('Отдел закупок');
  });

  it('keeps the author position out of the header (it is printed in the signature)', () => {
    const model = buildModel({
      template: classicTemplate,
      values: {
        'Наименование подразделения': { value: 'Отдел закупок', label: 'Подразделение', source: 'ai' },
        'Должность автора': { value: 'Ведущий специалист', label: 'Должность', source: 'ai' },
      },
    });
    const result = BLOCKS.orgHeader(model);
    const allText = result.map(extractParagraphText).join(' | ');
    expect(allText).not.toContain('Ведущий специалист');
    expect(allText).toContain('Отдел закупок');
  });

  it('renders only org name + address when subdivision and position are absent', () => {
    const organization = { name: 'ООО «Пример»', address: 'г. Казань, ул. Баумана, д. 5' };
    const model = buildModel({
      template: { ...classicTemplate, organization },
      values: {},
    });
    const result = BLOCKS.orgHeader(model);
    // One paragraph per line: organization name, then address
    expect(result.map(extractParagraphText)).toEqual([organization.name, organization.address]);
    const allText = result.map(extractParagraphText).join(' | ');
    // Should NOT contain subdivision or position values
    expect(allText).not.toContain('Отдел закупок');
    expect(allText).not.toContain('Ведущий специалист');
  });
});

// ── FIX 3: memo.json layout order ────────────────────────────────────────────

describe('FIX 3: memo.json layout order', () => {
  it('layout[0] is orgHeader', () => {
    expect(memoDocType.layout[0]).toBe('orgHeader');
  });

  it('layout[1] is docTitle', () => {
    expect(memoDocType.layout[1]).toBe('docTitle');
  });

  it('layout[2] is dateNumber', () => {
    expect(memoDocType.layout[2]).toBe('dateNumber');
  });

  it('layout[3] is addressee', () => {
    expect(memoDocType.layout[3]).toBe('addressee');
  });
});

// ── FIX 4: report.json layout order ──────────────────────────────────────────

describe('FIX 4: report.json layout order', () => {
  it('layout[0] is orgHeader', () => {
    expect(reportDocType.layout[0]).toBe('orgHeader');
  });

  it('layout[1] is docTitle', () => {
    expect(reportDocType.layout[1]).toBe('docTitle');
  });

  it('layout[2] is dateNumber', () => {
    expect(reportDocType.layout[2]).toBe('dateNumber');
  });

  it('layout[3] is addressee', () => {
    expect(reportDocType.layout[3]).toBe('addressee');
  });
});

// ── FIX 5: reference.json includes addressee ─────────────────────────────────

describe('FIX 5: reference.json includes addressee', () => {
  it('layout includes addressee after dateNumber', () => {
    const layout = referenceDocType.layout;
    const dateIdx = layout.indexOf('dateNumber');
    const addrIdx = layout.indexOf('addressee');
    expect(dateIdx).toBeGreaterThanOrEqual(0);
    expect(addrIdx).toBeGreaterThan(dateIdx);
  });

  it('layout matches expected sequence', () => {
    expect(referenceDocType.layout).toEqual([
      'orgHeader', 'docTitle', 'dateNumber', 'addressee', 'title', 'body', 'signature',
    ]);
  });
});

// ── FIX 6: explanatory-note.json includes dateNumber and addressee ───────────

describe('FIX 6: explanatory-note.json includes dateNumber and addressee', () => {
  it('layout includes dateNumber and addressee after docTitle', () => {
    const layout = explanatoryNoteDocType.layout;
    const docTitleIdx = layout.indexOf('docTitle');
    const dateIdx = layout.indexOf('dateNumber');
    const addrIdx = layout.indexOf('addressee');
    expect(docTitleIdx).toBeGreaterThanOrEqual(0);
    expect(dateIdx).toBeGreaterThan(docTitleIdx);
    expect(addrIdx).toBeGreaterThan(dateIdx);
  });

  it('layout matches expected sequence', () => {
    expect(explanatoryNoteDocType.layout).toEqual([
      'orgHeader', 'docTitle', 'dateNumber', 'addressee', 'title', 'body', 'signature',
    ]);
  });
});

// ── COMBINATION TESTS: all 10 docType × template combos ─────────────────────

const DOC_TYPES = [
  { name: 'memo', docType: memoDocType },
  { name: 'report', docType: reportDocType },
  { name: 'reference', docType: referenceDocType },
  { name: 'letter', docType: letterDocType },
  { name: 'explanatory-note', docType: explanatoryNoteDocType },
];
const TEMPLATES = [
  { name: 'classic', template: classicTemplate },
  { name: 'modern', template: modernTemplate },
];

describe('Combination tests: layout validity for all docType × template', () => {
  for (const { name: docName, docType } of DOC_TYPES) {
    for (const { name: tplName, template } of TEMPLATES) {
      describe(`${docName} × ${tplName}`, () => {
        it('all layout entries are valid block names', () => {
          const layout = docType.layout;
          for (const entry of layout) {
            const blockName = Array.isArray(entry) ? entry[0] : entry;
            expect(BLOCKS, `Block "${blockName}" not found in BLOCKS registry`).toHaveProperty(blockName);
          }
        });

        it('orgHeader is the first element in layout', () => {
          const first = Array.isArray(docType.layout[0])
            ? docType.layout[0][0]
            : docType.layout[0];
          expect(first).toBe('orgHeader');
        });

        it('orgHeader renders when show=true', () => {
          const withOrg = { ...template, organization: { ...template.organization, name: 'ООО «Пример»' } };
          const result = BLOCKS.orgHeader(buildModel({ docType, template: withOrg, values: {} }));
          expect(result.length).toBeGreaterThan(0);
        });

        it('orgHeader leaves out an organization that is not set', () => {
          const result = BLOCKS.orgHeader(buildModel({ docType, template: { ...template, organization: { name: '' } }, values: {} }));
          expect(result).toHaveLength(0);
        });
      });
    }
  }
});
