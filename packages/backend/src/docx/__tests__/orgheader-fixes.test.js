import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { renderDocx } from '../render.js';
import { loadDocTypes } from '../../catalog/docTypes.js';
import { loadTemplates } from '../../catalog/templates.js';
import { halfPt } from '../units.js';

const docTypes = loadDocTypes('./config/doc-types');
const templates = loadTemplates('./config/templates', { error: () => {}, warn: () => {} });

/**
 * Build a minimal render model with overrides.
 * Values are injected by key directly — supports any key (field key, label, or manual).
 */
function buildModel({ docTypeId = 'memo', templateId = 'classic', values = {}, title = null, body = ['Тест.'], orgOverrides = {} } = {}) {
  const docType = docTypes.get(docTypeId);
  const { template } = templates.get(templateId);
  const valObj = {};
  // Inject all provided values directly by key
  for (const [k, v] of Object.entries(values)) {
    valObj[k] = { value: v, label: k, source: 'test' };
  }
  // Also create null entries for docType fields not explicitly provided
  for (const f of docType.fields) {
    if (!(f.label in valObj)) {
      valObj[f.label] = { value: null, label: f.label, source: 'test' };
    }
  }
  const tpl = { ...template, organization: { ...template.organization, ...orgOverrides } };
  return { docType, template: tpl, values: valObj, title, body };
}

/** Render DOCX and return word/document.xml string. */
async function getDocXml(overrides = {}) {
  const buffer = await renderDocx(buildModel(overrides));
  const zip = await JSZip.loadAsync(buffer);
  return zip.file('word/document.xml').async('string');
}

// ══════════════════════════════════════════════════════════════════════════════
// Group 1 — Все 5 шаблонов/doctype рендерят orgHeader
// ══════════════════════════════════════════════════════════════════════════════

describe('Group 1 — Все 5 шаблонов/doctype рендерят orgHeader', () => {
  it('memo+classic: renders orgHeader with org details', async () => {
    const xml = await getDocXml({
      templateId: 'classic',
      orgOverrides: { name: 'ООО «Пример»', inn: '7701234567' },
    });
    expect(xml).toContain('ООО «Пример»');
    expect(xml).toContain('г. Москва, ул. Примерная, д. 1');
    expect(xml).toContain('ИНН: 7701234567');
  });

  it('memo+modern: renders orgHeader', async () => {
    const xml = await getDocXml({
      templateId: 'modern',
      orgOverrides: { name: 'ООО «Пример»', inn: '7701234567' },
    });
    expect(xml).toContain('ООО «Пример»');
    expect(xml).toContain('ИНН: 7701234567');
  });

  it('report+classic: renders orgHeader', async () => {
    const xml = await getDocXml({
      docTypeId: 'report',
      templateId: 'classic',
      orgOverrides: { name: 'ООО «Пример»', inn: '7701234567' },
    });
    expect(xml).toContain('ООО «Пример»');
    expect(xml).toContain('ИНН: 7701234567');
  });

  it('report+modern: renders orgHeader', async () => {
    const xml = await getDocXml({
      docTypeId: 'report',
      templateId: 'modern',
      orgOverrides: { name: 'ООО «Пример»', inn: '7701234567' },
    });
    expect(xml).toContain('ООО «Пример»');
    expect(xml).toContain('ИНН: 7701234567');
  });

  it('letter+classic: renders orgHeader', async () => {
    const xml = await getDocXml({
      docTypeId: 'letter',
      templateId: 'classic',
      orgOverrides: { name: 'ООО «Пример»', inn: '7701234567' },
    });
    expect(xml).toContain('ООО «Пример»');
    expect(xml).toContain('ИНН: 7701234567');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Group 2 — modern.orgHeader.show=true: modern template now renders orgHeader
// ══════════════════════════════════════════════════════════════════════════════

describe('Group 2 — modern.orgHeader.show=true renders orgHeader', () => {
  it('memo+modern: renders orgHeader in body', async () => {
    const xml = await getDocXml({
      templateId: 'modern',
      orgOverrides: { name: 'ООО «Пример»' },
    });
    expect(xml).toContain('ООО «Пример»');
  });

  it('report+modern: renders orgHeader in body', async () => {
    const xml = await getDocXml({
      docTypeId: 'report',
      templateId: 'modern',
      orgOverrides: { name: 'ООО «Пример»' },
    });
    expect(xml).toContain('ООО «Пример»');
  });

  it('reference+modern: renders orgHeader in body', async () => {
    const xml = await getDocXml({
      docTypeId: 'reference',
      templateId: 'modern',
      orgOverrides: { name: 'ООО «Пример»' },
    });
    expect(xml).toContain('ООО «Пример»');
  });

  it('letter+modern: renders orgHeader in body', async () => {
    const xml = await getDocXml({
      docTypeId: 'letter',
      templateId: 'modern',
      orgOverrides: { name: 'ООО «Пример»' },
    });
    expect(xml).toContain('ООО «Пример»');
  });

  it('memo+modern: does NOT render orgHeader in header', async () => {
    const xml = await getDocXml({
      templateId: 'modern',
      orgOverrides: { name: 'ООО «Пример»' },
    });
    // Header only has PAGE number (center alignment). org name is in body, not header.
    const headerMatch = xml.match(/<w:hdr[\s\S]*?<\/w:hdr>/);
    if (headerMatch) {
      expect(headerMatch[0]).not.toContain('ООО «Пример»');
    }
    // And it IS in the document body
    expect(xml).toContain('ООО «Пример»');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Group 3 — Subdivision (req 06) и Position (req 07) rendering
// ══════════════════════════════════════════════════════════════════════════════

describe('Group 3 — Subdivision and Position rendering', () => {
  const combos = [
    ['memo', 'classic'],
    ['memo', 'modern'],
    ['report', 'classic'],
    ['report', 'modern'],
    ['letter', 'classic'],
    ['letter', 'modern'],
  ];

  for (const [docTypeId, templateId] of combos) {
    it(`${docTypeId}+${templateId}: renders subdivision`, async () => {
      // orgHeader reads model.values['Наименование подразделения']?.value (field key)
      const xml = await getDocXml({
        docTypeId,
        templateId,
        orgOverrides: { name: 'ООО «Пример»' },
        values: {
          'Наименование подразделения': 'Подразделение автора',
        },
      });
      expect(xml).toContain('Подразделение автора');
    });

    it(`${docTypeId}+${templateId}: renders position`, async () => {
      // orgHeader reads model.values['Должность автора']?.value (field key)
      const xml = await getDocXml({
        docTypeId,
        templateId,
        orgOverrides: { name: 'ООО «Пример»' },
        values: {
          'Должность автора': 'Должность руководителя',
        },
      });
      expect(xml).toContain('Должность руководителя');
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// Group 4 — dateNumber: от prefix не дублируется
// ══════════════════════════════════════════════════════════════════════════════

describe('Group 4 — dateNumber: от prefix не дублируется', () => {
  it('memo+classic with date "от 13.09.2026": does NOT contain "от от"', async () => {
    const xml = await getDocXml({
      templateId: 'classic',
      values: { 'Дата': 'от 13.09.2026', 'Номер': '1/2026' },
    });
    expect(xml).toContain('от 13.09.2026');
    expect(xml).not.toContain('от от');
  });

  it('memo+modern with date "от 13.09.2026": does NOT contain "от от"', async () => {
    const xml = await getDocXml({
      templateId: 'modern',
      values: { 'Дата': 'от 13.09.2026', 'Номер': '1/2026' },
    });
    expect(xml).toContain('от 13.09.2026');
    expect(xml).not.toContain('от от');
  });

  it('memo+classic with date without "от": prepends "от " without duplication', async () => {
    const xml = await getDocXml({
      templateId: 'classic',
      values: { 'Дата': '13.09.2026', 'Номер': '1/2026' },
    });
    expect(xml).toContain('от ');
    expect(xml).toContain('13.09.2026');
    expect(xml).not.toContain('от от');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Group 5 — Font size from model (halfPt fix)
// ══════════════════════════════════════════════════════════════════════════════

describe('Group 5 — Font size from model (halfPt fix)', () => {
  const fontCombos = [
    ['memo', 'classic', 14],
    ['memo', 'modern', 12],
    ['report', 'classic', 14],
    ['report', 'modern', 12],
  ];

  for (const [docTypeId, templateId, sizePt] of fontCombos) {
    it(`${docTypeId}+${templateId}: attachment block uses font size from model (${sizePt}pt = ${halfPt(sizePt)} halfPt)`, async () => {
      const model = buildModel({ docTypeId, templateId, body: ['Тест.'] });
      model['Приложение'] = ['Документ 1.pdf'];
      const buffer = await renderDocx(model);
      const zip = await JSZip.loadAsync(buffer);
      const xml = await zip.file('word/document.xml').async('string');
      expect(xml).toContain('Приложение:');
      expect(xml).toContain(`<w:sz w:val="${halfPt(sizePt)}"/>`);
    });

    it(`${docTypeId}+${templateId}: copy block uses font size from model (${sizePt}pt = ${halfPt(sizePt)} halfPt)`, async () => {
      const model = buildModel({ docTypeId, templateId, body: ['Тест.'] });
      // Copy block is not in memo/report layout by default — inject it for testing
      model.docType = { ...model.docType, layout: [...model.docType.layout, 'copyBlock'] };
      model['Копия'] = ['Иванов И.И.'];
      const buffer = await renderDocx(model);
      const zip = await JSZip.loadAsync(buffer);
      const xml = await zip.file('word/document.xml').async('string');
      expect(xml).toContain('Копия:');
      expect(xml).toContain(`<w:sz w:val="${halfPt(sizePt)}"/>`);
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// Group 6 — Шапка order: orgHeader → docTitle → dateNumber → addressee
// ══════════════════════════════════════════════════════════════════════════════

describe('Group 6 — Шапка order: orgHeader → docTitle → dateNumber → addressee', () => {
  const orderCombos = [
    ['memo', 'classic', 'СЛУЖЕБНАЯ ЗАПИСКА', 'Адресат'],
    ['memo', 'modern', 'СЛУЖЕБНАЯ ЗАПИСКА', 'Адресат'],
    ['report', 'classic', 'ДОКЛАДНАЯ ЗАПИСКА', 'Адресат'],
    ['report', 'modern', 'ДОКЛАДНАЯ ЗАПИСКА', 'Адресат'],
    ['reference', 'classic', 'СПРАВКА', 'Адресат'],
    ['reference', 'modern', 'СПРАВКА', 'Адресат'],
    ['letter', 'classic', null, 'Лицо адресата'],
    ['letter', 'modern', null, 'Лицо адресата'],
    ['explanatory-note', 'classic', 'ПОЯСНИТЕЛЬНАЯ ЗАПИСКА', 'Адресат'],
    ['explanatory-note', 'modern', 'ПОЯСНИТЕЛЬНАЯ ЗАПИСКА', 'Адресат'],
  ];

  for (const [docTypeId, templateId, docTitle, addresseeKey] of orderCombos) {
    it(`${docTypeId}+${templateId}: correct block order`, async () => {
      // Build addressee values based on docType
      const addresseeValues = {};
      if (docTypeId === 'letter') {
        addresseeValues['Лицо адресата'] = 'Директору Иванову И.И.';
        addresseeValues['Организация адресата'] = 'ООО Тест';
      } else {
        addresseeValues['Адресат'] = 'Директору Иванову И.И.';
      }

      const xml = await getDocXml({
        docTypeId,
        templateId,
        orgOverrides: { name: 'ООО «Пример»' },
        values: {
          'Дата': '13.09.2026',
          'Номер': '1/2026',
          ...addresseeValues,
        },
      });

      const orgIdx = xml.indexOf('ООО «Пример»');
      // Date value may be in a separate TextRun from "от " prefix, so search just the date
      const dateIdx = xml.indexOf('13.09.2026');
      const addresseeIdx = xml.indexOf('Иванову И.И.');

      expect(orgIdx).toBeGreaterThan(-1);
      expect(dateIdx).toBeGreaterThan(-1);
      expect(addresseeIdx).toBeGreaterThan(-1);

      // orgHeader must come before dateNumber
      expect(orgIdx).toBeLessThan(dateIdx);
      // dateNumber must come before addressee
      expect(dateIdx).toBeLessThan(addresseeIdx);

      if (docTitle) {
        const titleIdx = xml.indexOf(docTitle);
        expect(titleIdx).toBeGreaterThan(-1);
        // orgHeader before docTitle
        expect(orgIdx).toBeLessThan(titleIdx);
        // docTitle before dateNumber
        expect(titleIdx).toBeLessThan(dateIdx);
      }
    });
  }
});
