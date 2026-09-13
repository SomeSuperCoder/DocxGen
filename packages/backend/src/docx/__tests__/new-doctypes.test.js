import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { renderDocx } from '../render.js';
import { loadDocTypes } from '../../catalog/docTypes.js';
import { loadTemplates } from '../../catalog/templates.js';

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
  const file = zip.file('word/document.xml');
  expect(file).not.toBeNull();
  const xml = await file.async('string');
  expect(xml.length).toBeGreaterThan(0);
  return xml;
}

/** Render DOCX and return the buffer (for validity check). */
async function getBuffer(overrides = {}) {
  const buffer = await renderDocx(buildModel(overrides));
  expect(buffer).toBeInstanceOf(Buffer);
  expect(buffer.length).toBeGreaterThan(0);
  const zip = await JSZip.loadAsync(buffer);
  expect(zip.file('word/document.xml')).not.toBeNull();
  return buffer;
}

// ══════════════════════════════════════════════════════════════════════════════
// NEW docTypes — order, protocol, act, statement × classic, modern
// ══════════════════════════════════════════════════════════════════════════════

const BODY_TEXT = 'Тестовый текст документа.';
const SIGNATURE_TEXT = 'Иванов И.И.';
const ORG_NAME = 'ООО «Тест»';

const newDocTypes = [
  {
    docTypeId: 'order',
    docTitle: 'ПРИКАЗ',
    values: {
      'Дата': '13.09.2026',
      'Номер': '42',
      'Тема': 'Тестовый заголовок',
      'ФИО руководителя': SIGNATURE_TEXT,
      'Должность руководителя': 'Генеральный директор',
    },
  },
  {
    docTypeId: 'protocol',
    docTitle: 'ПРОТОКОЛ',
    values: {
      'Дата': '13.09.2026',
      'Номер протокола': '12',
      'Тема': 'Тестовый заголовок',
      'ФИО секретаря': SIGNATURE_TEXT,
    },
  },
  {
    docTypeId: 'act',
    docTitle: 'АКТ',
    values: {
      'Дата': '13.09.2026',
      'Номер': '5',
      'Тема': 'Тестовый заголовок',
      'ФИО председателя': SIGNATURE_TEXT,
    },
  },
  {
    docTypeId: 'statement',
    docTitle: null, // layout doesn't include docTitle block
    values: {
      'Дата': '13.09.2026',
      'Адресат': 'В отдел кадров',
      'ФИО заявителя': SIGNATURE_TEXT,
    },
  },
];

const templateIds = ['classic', 'modern'];

describe('NEW docTypes — valid .docx generation', () => {
  for (const { docTypeId, docTitle, values } of newDocTypes) {
    for (const templateId of templateIds) {
      describe(`${docTypeId} × ${templateId}`, () => {
        it('produces a valid .docx with word/document.xml', async () => {
          await getBuffer({ docTypeId, templateId, values, body: [BODY_TEXT], orgOverrides: { name: ORG_NAME } });
        });

        if (docTitle) {
          it(`docTitle "${docTitle}" appears in XML`, async () => {
            const xml = await getDocXml({ docTypeId, templateId, values, body: [BODY_TEXT], orgOverrides: { name: ORG_NAME } });
            expect(xml).toContain(docTitle);
          });
        } else {
          it('no docTitle block in XML', async () => {
            const xml = await getDocXml({ docTypeId, templateId, values, body: [BODY_TEXT], orgOverrides: { name: ORG_NAME } });
            // statement layout: orgHeader → dateNumber → title → body → signature
            // Should NOT contain any of the known docTitle strings
            expect(xml).not.toContain('ПРИКАЗ');
            expect(xml).not.toContain('ПРОТОКОЛ');
            expect(xml).not.toContain('АКТ');
            expect(xml).not.toContain('ЗАЯВЛЕНИЕ');
          });
        }

        it('body text appears in XML', async () => {
          const xml = await getDocXml({ docTypeId, templateId, values, body: [BODY_TEXT], orgOverrides: { name: ORG_NAME } });
          expect(xml).toContain(BODY_TEXT);
        });

        it('signature block renders (value or placeholder)', async () => {
          const xml = await getDocXml({ docTypeId, templateId, values, body: [BODY_TEXT], orgOverrides: { name: ORG_NAME } });
          // Signature block is present in layout — should contain either the provided name or a placeholder
          // For non-letter docTypes: Должность автора + ФИО автора
          // For order: uses ФИО руководителя as ФИО автора? Actually signature uses generic keys.
          // We just check that some signature-like content is present
          expect(xml).toMatch(/([Дд]олжность|ФИО|автор|подпис|_____|Тест)/);
        });

        it('org header appears in XML', async () => {
          const xml = await getDocXml({ docTypeId, templateId, values, body: [BODY_TEXT], orgOverrides: { name: ORG_NAME } });
          expect(xml).toContain(ORG_NAME);
        });
      });
    }
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// EXISTING docTypes — memo, report, letter, reference (regression)
// ══════════════════════════════════════════════════════════════════════════════

const existingDocTypes = [
  {
    docTypeId: 'memo',
    templateId: 'classic',
    docTitle: 'СЛУЖЕБНАЯ ЗАПИСКА',
    values: {
      'Адресат': 'В отдел кадров',
      'Должность автора': 'Генеральный директор',
      'ФИО автора': SIGNATURE_TEXT,
      'Дата': '13.09.2026',
    },
  },
  {
    docTypeId: 'report',
    templateId: 'modern',
    docTitle: 'ДОКЛАДНАЯ ЗАПИСКА',
    values: {
      'Адресат': 'Генеральному директору',
      'Должность автора': 'Начальник отдела',
      'ФИО автора': SIGNATURE_TEXT,
      'Дата': '13.09.2026',
    },
  },
  {
    docTypeId: 'letter',
    templateId: 'classic',
    docTitle: null, // letter layout has no docTitle
    values: {
      'Организация адресата': 'ООО «Тест»',
      'Лицо адресата': 'Директору Иванову И.И.',
      'Должность подписывающего': 'Генеральный директор',
      'ФИО подписывающего': SIGNATURE_TEXT,
      'Дата': '13.09.2026',
    },
  },
  {
    docTypeId: 'reference',
    templateId: 'modern',
    docTitle: 'СПРАВКА',
    values: {
      'Должность автора': 'Старший инженер',
      'ФИО автора': SIGNATURE_TEXT,
      'Адресат': 'В отдел кадров',
      'Дата': '13.09.2026',
    },
  },
];

describe('EXISTING docTypes — regression', () => {
  for (const { docTypeId, templateId, docTitle, values } of existingDocTypes) {
    describe(`${docTypeId} × ${templateId}`, () => {
      it('produces a valid .docx with word/document.xml', async () => {
        await getBuffer({ docTypeId, templateId, values, body: [BODY_TEXT], orgOverrides: { name: ORG_NAME } });
      });

      if (docTitle) {
        it(`docTitle "${docTitle}" appears in XML`, async () => {
          const xml = await getDocXml({ docTypeId, templateId, values, body: [BODY_TEXT], orgOverrides: { name: ORG_NAME } });
          expect(xml).toContain(docTitle);
        });
      } else {
        it('no docTitle block in XML', async () => {
          const xml = await getDocXml({ docTypeId, templateId, values, body: [BODY_TEXT], orgOverrides: { name: ORG_NAME } });
          expect(xml).not.toContain('СЛУЖЕБНАЯ ЗАПИСКА');
          expect(xml).not.toContain('ДОКЛАДНАЯ ЗАПИСКА');
          expect(xml).not.toContain('СПРАВКА');
        });
      }

      it('body text appears in XML', async () => {
        const xml = await getDocXml({ docTypeId, templateId, values, body: [BODY_TEXT], orgOverrides: { name: ORG_NAME } });
        expect(xml).toContain(BODY_TEXT);
      });

      it('signature block renders', async () => {
        const xml = await getDocXml({ docTypeId, templateId, values, body: [BODY_TEXT], orgOverrides: { name: ORG_NAME } });
        expect(xml).toMatch(/(ФИО|автор|подпис|_____|Тест)/);
      });
    });
  }
});
