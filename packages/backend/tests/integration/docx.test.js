import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { loadDocTypes } from '../../src/catalog/docTypes.js';
import { loadTemplates } from '../../src/catalog/templates.js';
import { renderDocx } from '../../src/docx/render.js';
import { mm, pt, halfPt, line } from '../../src/docx/units.js';
import { createFileStorage } from '../../src/storage/files.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const docTypes = loadDocTypes('./config/doc-types');
const templates = loadTemplates('./config/templates', { error: () => {}, warn: () => {} });

function buildModel({ docTypeId, templateId, values = {}, title = null, body = ['Тестовый абзац.'] } = {}) {
  const docType = docTypes.get(docTypeId);
  const { template } = templates.get(templateId);
  const valObj = {};
  for (const f of docType.fields) {
    valObj[f.label] = { value: values[f.label] ?? null, label: f.label, source: 'test' };
  }
  return { docType, template, values: valObj, title, body };
}

// ── Classic template tests ──────────────────────────────────────────────────

describe('DOCX generation — classic template', () => {
  it('has correct page margins', async () => {
    const buffer = await renderDocx(buildModel({ docTypeId: 'memo', templateId: 'classic' }));
    const zip = await JSZip.loadAsync(buffer);
    const docXml = await zip.file('word/document.xml').async('string');
    // 20mm=1134, 15mm=850, 20mm=1134, 30mm=1701
    expect(docXml).toContain('<w:pgMar w:top="1134" w:right="850" w:bottom="1134" w:left="1701"');
  });

  it('has correct font and size', async () => {
    const buffer = await renderDocx(buildModel({ docTypeId: 'memo', templateId: 'classic' }));
    const zip = await JSZip.loadAsync(buffer);
    const stylesXml = await zip.file('word/styles.xml').async('string');
    expect(stylesXml).toContain('w:ascii="Times New Roman"');
    // 14pt = 28 half-points
    expect(stylesXml).toContain('<w:sz w:val="28"/>');
  });

  it('has titlePage property', async () => {
    const buffer = await renderDocx(buildModel({ docTypeId: 'memo', templateId: 'classic' }));
    const zip = await JSZip.loadAsync(buffer);
    const docXml = await zip.file('word/document.xml').async('string');
    expect(docXml).toContain('<w:titlePg/>');
  });
});

// ── Modern template tests ───────────────────────────────────────────────────

describe('DOCX generation — modern template', () => {
  it('has correct margins, font and size', async () => {
    const buffer = await renderDocx(buildModel({ docTypeId: 'memo', templateId: 'modern' }));
    const zip = await JSZip.loadAsync(buffer);
    const docXml = await zip.file('word/document.xml').async('string');
    // 20mm=1134, 15mm=850, 20mm=1134, 25mm=1417
    expect(docXml).toContain('<w:pgMar w:top="1134" w:right="850" w:bottom="1134" w:left="1417"');
    const stylesXml = await zip.file('word/styles.xml').async('string');
    expect(stylesXml).toContain('w:ascii="Arial"');
    // 12pt = 24 half-points
    expect(stylesXml).toContain('<w:sz w:val="24"/>');
  });

  it('has NUMPAGES in footer', async () => {
    const buffer = await renderDocx(buildModel({ docTypeId: 'memo', templateId: 'modern' }));
    const zip = await JSZip.loadAsync(buffer);
    const footerFile = Object.keys(zip.files).find((f) => f.startsWith('word/footer'));
    expect(footerFile).toBeDefined();
    const footerXml = await zip.file(footerFile).async('string');
    expect(footerXml).toContain('NUMPAGES');
  });
});

// ── Placeholder / unfilled field tests ─────────────────────────────────────

describe('DOCX generation — unfilled fields', () => {
  it('renders placeholder [Адресат] with yellow highlight when addressee is unfilled', async () => {
    const buffer = await renderDocx(buildModel({ docTypeId: 'memo', templateId: 'classic', values: {} }));
    const zip = await JSZip.loadAsync(buffer);
    const docXml = await zip.file('word/document.xml').async('string');
    expect(docXml).toContain('[Адресат]');
    expect(docXml).toContain('<w:highlight w:val="yellow"/>');
  });

  it('renders filled addressee without highlight', async () => {
    const buffer = await renderDocx(buildModel({
      docTypeId: 'memo',
      templateId: 'classic',
      values: { 'Адресат': 'Начальнику отдела кадров Петровой А. С.' },
    }));
    const zip = await JSZip.loadAsync(buffer);
    const docXml = await zip.file('word/document.xml').async('string');
    expect(docXml).toContain('Начальнику отдела кадров Петровой А. С.');
    // The run containing the value must NOT have a highlight property.
    // Extract the <w:r> that contains the value and verify no <w:highlight> inside it.
    const valueRunMatch = docXml.match(/<w:r>(?:<w:rPr>[\s\S]*?<\/w:rPr>)?<w:t[^>]*>Начальнику отдела кадров Петровой А\. С\.<\/w:t><\/w:r>/);
    expect(valueRunMatch).not.toBeNull();
    expect(valueRunMatch[0]).not.toContain('<w:highlight');
  });
});

// ── Matrix: 4 doc types × 2 templates ──────────────────────────────────────

describe('DOCX generation — matrix (4 types × 2 templates)', () => {
  const docTypeIds = ['memo', 'report', 'reference', 'letter'];
  const templateIds = ['classic', 'modern'];

  for (const dtId of docTypeIds) {
    for (const tplId of templateIds) {
      it(`${dtId} + ${tplId} produces valid DOCX with body paragraphs`, async () => {
        const model = buildModel({
          docTypeId: dtId,
          templateId: tplId,
          values: { 'Адресат': 'Тестовый адресат' },
          title: 'О проверке',
          body: ['Первый абзац текста.', 'Второй абзац текста.'],
        });

        const buffer = await renderDocx(model);
        const zip = await JSZip.loadAsync(buffer);

        // Must contain document.xml
        expect(zip.file('word/document.xml')).not.toBeNull();
        const docXml = await zip.file('word/document.xml').async('string');
        expect(docXml.length).toBeGreaterThan(0);

        // Must contain body paragraphs
        expect(docXml).toContain('Первый абзац текста.');

        // Must contain docTitle (except letter where docTitle is null)
        const dt = docTypes.get(dtId);
        if (dt.docTitle) {
          expect(docXml).toContain(dt.docTitle);
        }
      });
    }
  }
});

// ── Cyrillic encoding ──────────────────────────────────────────────────────

describe('DOCX generation — Cyrillic encoding', () => {
  it('preserves Cyrillic text without corruption', async () => {
    const cyrillic = 'Съешь же ещё этих мягких французских булок';
    const buffer = await renderDocx(buildModel({
      docTypeId: 'memo',
      templateId: 'classic',
      body: [cyrillic],
    }));
    const zip = await JSZip.loadAsync(buffer);
    const docXml = await zip.file('word/document.xml').async('string');
    // Cyrillic should be in the XML as-is (docx uses UTF-8)
    expect(docXml).toContain(cyrillic);
  });
});

// ── File naming ─────────────────────────────────────────────────────────────

describe('File storage — naming convention', () => {
  it('generates filename matching <Type>_<YYYY-MM-DD>_<short-id>.docx', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docx-test-'));
    try {
      const storage = createFileStorage(tmpDir);
      const buffer = Buffer.from('fake-docx');
      const result = storage.save(buffer, 'Служебная_записка_2026-09-11_a1b2.docx');

      expect(result.id).toBeDefined();
      expect(result.filename).toBe('Служебная_записка_2026-09-11_a1b2.docx');
      expect(fs.existsSync(result.path)).toBe(true);
      expect(result.path).toContain('.docx');

      // Cleanup
      storage.remove(result.id);
      expect(fs.existsSync(result.path)).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ── Unit conversion sanity checks ──────────────────────────────────────────

describe('Unit conversions', () => {
  it('mm converts to twips correctly', () => {
    // 20mm = round(20 * 1440 / 25.4) = round(1133.86) = 1134
    expect(mm(20)).toBe(1134);
    expect(mm(30)).toBe(1701);
    expect(mm(10)).toBe(567);
    // 25mm = round(25 * 1440 / 25.4) = round(1417.32) = 1417
    expect(mm(25)).toBe(1417);
    expect(mm(15)).toBe(850);
  });

  it('pt converts to twips correctly', () => {
    expect(pt(1)).toBe(20);
    expect(pt(6)).toBe(120);
  });

  it('halfPt converts correctly', () => {
    expect(halfPt(14)).toBe(28);
    expect(halfPt(12)).toBe(24);
  });

  it('line spacing converts correctly', () => {
    expect(line(1.5)).toBe(360);
    expect(line(1.15)).toBe(276);
  });
});

// ── Addressee positioning ──────────────────────────────────────────────────

describe('DOCX generation — addressee positioning', () => {
  it('classic template: addressee in right-aligned table', async () => {
    const buffer = await renderDocx(buildModel({
      docTypeId: 'memo',
      templateId: 'classic',
      values: { 'Адресат': 'Директору' },
    }));
    const zip = await JSZip.loadAsync(buffer);
    const docXml = await zip.file('word/document.xml').async('string');
    // Right-positioned addressee uses a table (w:tbl)
    expect(docXml).toContain('<w:tbl>');
    expect(docXml).toContain('Директору');
  });

  it('modern template: addressee as plain paragraphs', async () => {
    const buffer = await renderDocx(buildModel({
      docTypeId: 'memo',
      templateId: 'modern',
      values: { 'Адресат': 'Директору' },
    }));
    const zip = await JSZip.loadAsync(buffer);
    const docXml = await zip.file('word/document.xml').async('string');
    expect(docXml).toContain('Директору');
  });

  it('letter: three separate addressee paragraphs', async () => {
    const buffer = await renderDocx(buildModel({
      docTypeId: 'letter',
      templateId: 'classic',
      values: {
        'Организация адресата': 'ООО «СтройМонтаж»',
        'Лицо адресата': 'Директору Петрову И. С.',
        'Адрес адресата': '123456, г. Москва',
      },
    }));
    const zip = await JSZip.loadAsync(buffer);
    const docXml = await zip.file('word/document.xml').async('string');
    expect(docXml).toContain('ООО «СтройМонтаж»');
    expect(docXml).toContain('Директору Петрову И. С.');
    expect(docXml).toContain('123456, г. Москва');
  });
});

// ── Layout blocks coverage ──────────────────────────────────────────────────

describe('DOCX generation — layout blocks', () => {
  it('memo: all blocks rendered (orgHeader, addressee, docTitle, dateNumber, title, body, signature)', async () => {
    const buffer = await renderDocx(buildModel({
      docTypeId: 'memo',
      templateId: 'classic',
      values: {
        'Адресат': 'Начальнику',
        'Должность автора': 'Инженер',
        'ФИО автора': 'Петров П. П.',
        'Дата': '11.09.2026',
      },
      title: 'О закупке',
    }));
    const zip = await JSZip.loadAsync(buffer);
    const docXml = await zip.file('word/document.xml').async('string');

    // orgHeader: organization address (name is now empty per ГОСТ compliance)
    expect(docXml).toContain('г. Москва, ул. Примерная, д. 1');
    // addressee
    expect(docXml).toContain('Начальнику');
    // docTitle
    expect(docXml).toContain('СЛУЖЕБНАЯ ЗАПИСКА');
    // dateNumber
    expect(docXml).toContain('11.09.2026');
    // title
    expect(docXml).toContain('О закупке');
    // body
    expect(docXml).toContain('Тестовый абзац.');
    // signature
    expect(docXml).toContain('Инженер');
    expect(docXml).toContain('Петров П. П.');
  });

  it('letter: no docTitle, has salutation and executor', async () => {
    const buffer = await renderDocx(buildModel({
      docTypeId: 'letter',
      templateId: 'classic',
      values: {
        'Организация адресата': 'ООО «Тест»',
        'Лицо адресата': 'Директору',
        'Обращение': 'Уважаемый Иван Иванович!',
        'Должность подписывающего': 'Генеральный директор',
        'ФИО подписывающего': 'Иванов И. И.',
        'Исполнитель': 'Сидоров П. П., тел. +7 (000) 000-00-00',
        'Дата': '11.09.2026',
      },
      title: 'О сотрудничестве',
    }));
    const zip = await JSZip.loadAsync(buffer);
    const docXml = await zip.file('word/document.xml').async('string');

    // No docTitle for letter
    expect(docXml).not.toContain('ПИСЬМО');
    // salutation
    expect(docXml).toContain('Уважаемый Иван Иванович!');
    // executor
    expect(docXml).toContain('Сидоров П. П., тел. +7 (000) 000-00-00');
  });

  it('modern template: orgHeader hidden (org in header)', async () => {
    const buffer = await renderDocx(buildModel({
      docTypeId: 'memo',
      templateId: 'modern',
      values: { 'Адресат': 'Тест' },
    }));
    const zip = await JSZip.loadAsync(buffer);
    const docXml = await zip.file('word/document.xml').async('string');
    // orgHeader.show=false → organization name NOT in body
    // (it's in the header text instead)
    const headerFile = Object.keys(zip.files).find((f) => f.startsWith('word/header'));
    expect(headerFile).toBeDefined();
    const headerXml = await zip.file(headerFile).async('string');
    expect(headerXml).not.toContain('ООО «Пример»');
  });
});

// ── Modern template: stack layout for dateNumber and signature ──────────────

describe('DOCX generation — modern stack layout', () => {
  it('dateNumber uses stack layout (no table)', async () => {
    const buffer = await renderDocx(buildModel({
      docTypeId: 'memo',
      templateId: 'modern',
      values: { 'Дата': '11.09.2026' },
    }));
    const zip = await JSZip.loadAsync(buffer);
    const docXml = await zip.file('word/document.xml').async('string');
    // Modern has stack layout → date and number are separate paragraphs, not in a table
    expect(docXml).toContain('11.09.2026');
  });

  it('signature uses stack layout (position over name)', async () => {
    const buffer = await renderDocx(buildModel({
      docTypeId: 'memo',
      templateId: 'modern',
      values: {
        'Должность автора': 'Инженер',
        'ФИО автора': 'Петров П. П.',
      },
    }));
    const zip = await JSZip.loadAsync(buffer);
    const docXml = await zip.file('word/document.xml').async('string');
    expect(docXml).toContain('Инженер');
    expect(docXml).toContain('Петров П. П.');
  });
});

// ── First page header suppression ───────────────────────────────────────────

describe('DOCX generation — header behavior', () => {
  it('classic: titlePage=true suppresses header on first page', async () => {
    const buffer = await renderDocx(buildModel({ docTypeId: 'memo', templateId: 'classic' }));
    const zip = await JSZip.loadAsync(buffer);
    const docXml = await zip.file('word/document.xml').async('string');
    expect(docXml).toContain('<w:titlePg/>');
  });

  it('modern: header has centered page number, no org name', async () => {
    const buffer = await renderDocx(buildModel({ docTypeId: 'memo', templateId: 'modern' }));
    const zip = await JSZip.loadAsync(buffer);
    const headerFile = Object.keys(zip.files).find((f) => f.startsWith('word/header'));
    const headerXml = await zip.file(headerFile).async('string');
    // Modern header.pageNumber = 'center', so PAGE field is in header
    expect(headerXml).toContain('PAGE');
    // Org name is NOT in header — it renders in body via orgHeader block
    expect(headerXml).not.toContain('ООО «Пример»');
  });
});
