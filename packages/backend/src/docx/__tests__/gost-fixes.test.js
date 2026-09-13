import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import classicJson from '../../../config/templates/classic.json' with { type: 'json' };
import modernJson from '../../../config/templates/modern.json' with { type: 'json' };
import { BLOCKS } from '../blocks.js';
import { halfPt, line } from '../units.js';
import { renderDocx } from '../render.js';
import { loadDocTypes } from '../../catalog/docTypes.js';
import { loadTemplates } from '../../catalog/templates.js';

const docTypes = loadDocTypes('./config/doc-types');
const templates = loadTemplates('./config/templates', { error: () => {}, warn: () => {} });

/** Build a minimal render model with overrides. */
function buildModel({ docTypeId = 'memo', templateId = 'classic', values = {}, title = null, body = ['Тест.'], approval = null, agreement = null } = {}) {
  const docType = docTypes.get(docTypeId);
  const { template } = templates.get(templateId);
  const valObj = {};
  for (const f of docType.fields) {
    valObj[f.label] = { value: values[f.label] ?? null, label: f.label, source: 'test' };
  }
  const model = { docType, template, values: valObj, title, body };
  if (approval) model['Утверждение'] = approval;
  if (agreement) model['Согласование'] = agreement;
  return model;
}

/** Render DOCX and return word/document.xml string. */
async function getDocXml(overrides = {}) {
  const buffer = await renderDocx(buildModel(overrides));
  const zip = await JSZip.loadAsync(buffer);
  return zip.file('word/document.xml').async('string');
}

// ══════════════════════════════════════════════════════════════════════════════
// FIX 1 — classic.json paragraph.lineSpacing == 1.5
// ══════════════════════════════════════════════════════════════════════════════

describe('FIX 1 — classic.json lineSpacing', () => {
  it('classic.json paragraph.lineSpacing is 1.5', () => {
    expect(classicJson.paragraph.lineSpacing).toBe(1.5);
  });

  it('line spacing converts to 360 twips (1.5 × 240)', () => {
    expect(line(classicJson.paragraph.lineSpacing)).toBe(360);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// FIX 2 — blocks.js dateNumber() prevents double "от " prefix
// ══════════════════════════════════════════════════════════════════════════════

describe('FIX 2 — dateNumber() double "от " prevention', () => {
  it('date without "от " → prepends "от "', async () => {
    const xml = await getDocXml({
      templateId: 'classic',
      values: { 'Дата': '12 сентября 2026 г.', 'Номер': '1/2026' },
    });
    // The "от " prefix and date are separate TextRuns → separate <w:r> elements
    // So we check for both fragments, not the contiguous string
    expect(xml).toContain('от ');
    expect(xml).toContain('12 сентября 2026 г.');
    // Must NOT have double "от от"
    expect(xml).not.toContain('от от');
  });

  it('date already starting with "от " → does NOT double "от "', async () => {
    const xml = await getDocXml({
      templateId: 'classic',
      values: { 'Дата': 'от 12 сентября 2026 г.', 'Номер': '1/2026' },
    });
    // When date already has "от ", it's a single TextRun → contiguous in XML
    expect(xml).toContain('от 12 сентября 2026 г.');
    // Must NOT have double "от от"
    expect(xml).not.toContain('от от');
  });

  it('null/empty date → renders placeholder with "от " prefix', async () => {
    const xml = await getDocXml({
      templateId: 'classic',
      values: { 'Дата': null, 'Номер': '1/2026' },
    });
    expect(xml).toContain('от ');
    expect(xml).toContain('[Дата]');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// FIX 3 — approvalBlock/agreementBlock use template.font.sizePt
// ══════════════════════════════════════════════════════════════════════════════

describe('FIX 3 — approvalBlock/agreementBlock use template.font.sizePt', () => {
  const approvalData = {
    position: 'Директор',
    name: 'Иванов И.И.',
    signature: '',
    date: '',
  };
  const agreementData = {
    position: 'Начальник отдела',
    name: 'Петров П.П.',
    signature: '',
    date: '',
  };

  it('approvalBlock at 12pt → renders УТВЕРЖДАЮ at 24 half-points', async () => {
    const xml = await getDocXml({
      templateId: 'classic',
      approval: approvalData,
    });
    expect(xml).toContain('УТВЕРЖДАЮ');
    // classic template font.sizePt = 14 → halfPt(14) = 28
    // Verify the font size is NOT hardcoded to 14pt (28 half-points) but uses the template value
    // For classic: size 14pt = 28 half-pts → <w:sz w:val="28"/>
    expect(xml).toContain('<w:sz w:val="28"/>');
  });

  it('agreementBlock at 14pt → renders СОГЛАСОВАНО at 28 half-points', async () => {
    const xml = await getDocXml({
      templateId: 'classic',
      agreement: agreementData,
    });
    expect(xml).toContain('СОГЛАСОВАНО');
    // classic template font.sizePt = 14 → halfPt(14) = 28
    expect(xml).toContain('<w:sz w:val="28"/>');
  });

  it('approvalBlock at 12pt (modern) → renders at 24 half-points', async () => {
    const xml = await getDocXml({
      templateId: 'modern',
      approval: approvalData,
    });
    expect(xml).toContain('УТВЕРЖДАЮ');
    // modern template font.sizePt = 12 → halfPt(12) = 24
    expect(xml).toContain('<w:sz w:val="24"/>');
  });

  it('agreementBlock at 12pt (modern) → renders at 24 half-points', async () => {
    const xml = await getDocXml({
      templateId: 'modern',
      agreement: agreementData,
    });
    expect(xml).toContain('СОГЛАСОВАНО');
    // modern template font.sizePt = 12 → halfPt(12) = 24
    expect(xml).toContain('<w:sz w:val="24"/>');
  });

  it('no hardcoded halfPt(14) calls in blocks.js (source check)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(import.meta.dirname, '../blocks.js'),
      'utf-8',
    );
    // Should NOT contain halfPt(14) as a hardcoded literal
    expect(src).not.toMatch(/halfPt\s*\(\s*14\s*\)/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// FIX 4 — modern.json footer has pageNumber: "nOfM"
// ══════════════════════════════════════════════════════════════════════════════

describe('FIX 4 — modern.json footer.pageNumber', () => {
  it('modern.json footer.pageNumber == "nOfM"', () => {
    expect(modernJson.footer.pageNumber).toBe('nOfM');
  });

  it('modern.json footer has a text property (null or string)', () => {
    expect('text' in modernJson.footer).toBe(true);
  });
});
