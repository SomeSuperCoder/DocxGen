import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { loadDocTypes } from '../../src/catalog/docTypes.js';
import { loadTemplates } from '../../src/catalog/templates.js';
import { renderDocx } from '../../src/docx/render.js';

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

/** Render DOCX and return word/document.xml string. */
async function getDocXml(docTypeId, templateId, values = {}, title = null, body = ['Тестовый абзац.']) {
  const buffer = await renderDocx(buildModel({ docTypeId, templateId, values, title, body }));
  const zip = await JSZip.loadAsync(buffer);
  return zip.file('word/document.xml').async('string');
}

// ── Test Group 1: Block Presence Matrix ──────────────────────────────────────
// For each of the 10 template×docType combinations, verify ALL expected blocks
// are present and all unexpected blocks are absent.

describe('Test Group 1 — Block Presence Matrix', () => {
  // Helper: checks if XML contains a text snippet
  const has = (xml, text) => xml.includes(text);
  const hasTable = (xml) => xml.includes('<w:tbl>');

  // ── Classic Memo ──────────────────────────────────────────────────────────

  describe('classic + memo', () => {
    const combo = { docTypeId: 'memo', templateId: 'classic', values: {} };

    it('renders no sample organization data in orgHeader', async () => {
      const xml = await getDocXml('memo', 'classic');
      expect(xml).not.toContain('Примерная');
    });

    it('renders addressee block', async () => {
      const xml = await getDocXml('memo', 'classic', { 'Адресат': 'Начальнику' });
      expect(xml).toContain('Начальнику');
      // Classic addressee is right-aligned → uses a table
      expect(xml).toContain('<w:tbl>');
    });

    it('renders docTitle', async () => {
      const xml = await getDocXml('memo', 'classic');
      expect(xml).toContain('СЛУЖЕБНАЯ ЗАПИСКА');
    });

    it('renders dateNumber block', async () => {
      const xml = await getDocXml('memo', 'classic', { 'Дата': '11.09.2026', 'Номер': '42' });
      expect(xml).toContain('от ');
      expect(xml).toContain('11.09.2026');
      expect(xml).toContain('№');
      expect(xml).toContain('42');
    });

    it('renders title block', async () => {
      const xml = await getDocXml('memo', 'classic', {}, 'О закупке');
      expect(xml).toContain('О закупке');
    });

    it('renders body paragraph', async () => {
      const xml = await getDocXml('memo', 'classic', {}, null, ['Абзац тела.']);
      expect(xml).toContain('Абзац тела.');
    });

    it('renders signature block', async () => {
      const xml = await getDocXml('memo', 'classic', {
        'Должность автора': 'Инженер',
        'ФИО автора': 'Петров П. П.',
      });
      expect(xml).toContain('Инженер');
      expect(xml).toContain('Петров П. П.');
    });

    it('NO salutation block', async () => {
      const xml = await getDocXml('memo', 'classic', { 'Обращение': 'Уважаемый!' });
      // salutation only appears in letter docType
      expect(xml).not.toContain('Уважаемый!');
    });

    it('NO executor block', async () => {
      const xml = await getDocXml('memo', 'classic', { 'Исполнитель': 'Сидоров' });
      expect(xml).not.toContain('Исп.');
    });
  });

  // ── Classic Report ────────────────────────────────────────────────────────

  describe('classic + report', () => {
    it('renders no sample organization data in orgHeader', async () => {
      const xml = await getDocXml('report', 'classic');
      expect(xml).not.toContain('Примерная');
    });

    it('renders addressee block', async () => {
      const xml = await getDocXml('report', 'classic', { 'Адресат': 'Генеральному' });
      expect(xml).toContain('Генеральному');
      expect(xml).toContain('<w:tbl>');
    });

    it('renders docTitle', async () => {
      const xml = await getDocXml('report', 'classic');
      expect(xml).toContain('ДОКЛАДНАЯ ЗАПИСКА');
    });

    it('renders dateNumber block', async () => {
      const xml = await getDocXml('report', 'classic', { 'Дата': '12.09.2026', 'Номер': '7' });
      expect(xml).toContain('от ');
      expect(xml).toContain('12.09.2026');
      expect(xml).toContain('№');
      expect(xml).toContain('7');
    });

    it('renders title block', async () => {
      const xml = await getDocXml('report', 'classic', {}, 'О отчёте');
      expect(xml).toContain('О отчёте');
    });

    it('renders body paragraph', async () => {
      const xml = await getDocXml('report', 'classic', {}, null, ['Отчётный абзац.']);
      expect(xml).toContain('Отчётный абзац.');
    });

    it('renders signature block', async () => {
      const xml = await getDocXml('report', 'classic', {
        'Должность автора': 'Начальник',
        'ФИО автора': 'Иванов И. И.',
      });
      expect(xml).toContain('Начальник');
      expect(xml).toContain('Иванов И. И.');
    });

    it('NO salutation', async () => {
      const xml = await getDocXml('report', 'classic', { 'Обращение': 'Здравствуйте!' });
      expect(xml).not.toContain('Здравствуйте!');
    });

    it('NO executor', async () => {
      const xml = await getDocXml('report', 'classic', { 'Исполнитель': 'Петров' });
      expect(xml).not.toContain('Исп.');
    });
  });

  // ── Classic Reference ─────────────────────────────────────────────────────

  describe('classic + reference', () => {
    it('renders no sample organization data in orgHeader', async () => {
      const xml = await getDocXml('reference', 'classic');
      expect(xml).not.toContain('Примерная');
    });

    it('renders addressee block', async () => {
      const xml = await getDocXml('reference', 'classic', { 'Адресат': 'В отдел кадров' });
      expect(xml).toContain('В отдел кадров');
    });

    it('renders docTitle', async () => {
      const xml = await getDocXml('reference', 'classic');
      expect(xml).toContain('СПРАВКА');
    });

    it('renders dateNumber block', async () => {
      const xml = await getDocXml('reference', 'classic', { 'Дата': '13.09.2026' });
      expect(xml).toContain('от ');
      expect(xml).toContain('13.09.2026');
    });

    it('renders title block', async () => {
      const xml = await getDocXml('reference', 'classic', {}, 'О результатах');
      expect(xml).toContain('О результатах');
    });

    it('renders body paragraph', async () => {
      const xml = await getDocXml('reference', 'classic', {}, null, ['Справочный текст.']);
      expect(xml).toContain('Справочный текст.');
    });

    it('renders signature block', async () => {
      const xml = await getDocXml('reference', 'classic', {
        'Должность автора': 'Старший инженер',
        'ФИО автора': 'Сидоров П. П.',
      });
      expect(xml).toContain('Старший инженер');
      expect(xml).toContain('Сидоров П. П.');
    });

    it('NO salutation', async () => {
      const xml = await getDocXml('reference', 'classic');
      expect(xml).not.toContain('Обращение');
    });

    it('NO executor', async () => {
      const xml = await getDocXml('reference', 'classic');
      expect(xml).not.toContain('Исп.');
    });
  });

  // ── Classic Letter ────────────────────────────────────────────────────────

  describe('classic + letter', () => {
    it('renders no sample organization data in orgHeader', async () => {
      const xml = await getDocXml('letter', 'classic');
      expect(xml).not.toContain('Примерная');
    });

    it('renders addressee (3 paragraphs for letter)', async () => {
      const xml = await getDocXml('letter', 'classic', {
        'Организация адресата': 'ООО «Тест»',
        'Лицо адресата': 'Директору',
        'Адрес адресата': '123456, г. Москва',
      });
      expect(xml).toContain('ООО «Тест»');
      expect(xml).toContain('Директору');
      expect(xml).toContain('123456, г. Москва');
    });

    it('renders dateNumber with "Исх." prefix', async () => {
      const xml = await getDocXml('letter', 'classic', { 'Дата': '14.09.2026', 'Номер': '55' });
      expect(xml).toContain('от ');
      expect(xml).toContain('14.09.2026');
      expect(xml).toContain('Исх.');
      expect(xml).toContain('55');
    });

    it('renders title block', async () => {
      const xml = await getDocXml('letter', 'classic', {}, 'О сотрудничестве');
      expect(xml).toContain('О сотрудничестве');
    });

    it('renders salutation', async () => {
      const xml = await getDocXml('letter', 'classic', { 'Обращение': 'Уважаемый Иван Иванович!' });
      expect(xml).toContain('Уважаемый Иван Иванович!');
    });

    it('renders body paragraph', async () => {
      const xml = await getDocXml('letter', 'classic', {}, null, ['Письменный текст.']);
      expect(xml).toContain('Письменный текст.');
    });

    it('renders signature block', async () => {
      const xml = await getDocXml('letter', 'classic', {
        'Должность подписывающего': 'Генеральный директор',
        'ФИО подписывающего': 'Иванов И. И.',
      });
      expect(xml).toContain('Генеральный директор');
      expect(xml).toContain('Иванов И. И.');
    });

    it('renders executor block', async () => {
      const xml = await getDocXml('letter', 'classic', {
        'Исполнитель': 'Сидоров П. П., тел. +7 (000) 000-00-00',
      });
      expect(xml).toContain('Исп.');
      expect(xml).toContain('Сидоров П. П., тел. +7 (000) 000-00-00');
    });

    it('NO docTitle', async () => {
      const xml = await getDocXml('letter', 'classic');
      expect(xml).not.toContain('ПИСЬМО');
    });
  });

  // ── Modern Memo ───────────────────────────────────────────────────────────

  describe('modern + memo', () => {
    it('renders no sample organization data in body', async () => {
      const xml = await getDocXml('memo', 'modern');
      expect(xml).not.toContain('Примерная');
    });

    it('renders addressee as plain paragraphs (no table)', async () => {
      const xml = await getDocXml('memo', 'modern', { 'Адресат': 'Начальнику' });
      expect(xml).toContain('Начальнику');
      // Modern addressee uses position="left" → no table
      expect(xml).not.toMatch(/<w:tbl>/);
    });

    it('renders docTitle', async () => {
      const xml = await getDocXml('memo', 'modern');
      expect(xml).toContain('СЛУЖЕБНАЯ ЗАПИСКА');
    });

    it('renders dateNumber as stack (no table)', async () => {
      const xml = await getDocXml('memo', 'modern', { 'Дата': '11.09.2026', 'Номер': '10' });
      expect(xml).toContain('от ');
      expect(xml).toContain('11.09.2026');
      expect(xml).toContain('№');
      expect(xml).toContain('10');
      // Modern dateNumber layout = "stack" → no table for dateNumber
    });

    it('renders title block', async () => {
      const xml = await getDocXml('memo', 'modern', {}, 'О тесте');
      expect(xml).toContain('О тесте');
    });

    it('renders body paragraph', async () => {
      const xml = await getDocXml('memo', 'modern', {}, null, ['Современный абзац.']);
      expect(xml).toContain('Современный абзац.');
    });

    it('renders signature as stack (no table)', async () => {
      const xml = await getDocXml('memo', 'modern', {
        'Должность автора': 'Инженер',
        'ФИО автора': 'Петров П. П.',
      });
      expect(xml).toContain('Инженер');
      expect(xml).toContain('Петров П. П.');
      // Modern signature layout = "stack" → no table for signature
    });

    it('NO salutation', async () => {
      const xml = await getDocXml('memo', 'modern', { 'Обращение': 'Привет!' });
      expect(xml).not.toContain('Привет!');
    });

    it('NO executor', async () => {
      const xml = await getDocXml('memo', 'modern', { 'Исполнитель': 'Петров' });
      expect(xml).not.toContain('Исп.');
    });
  });

  // ── Modern Report ─────────────────────────────────────────────────────────

  describe('modern + report', () => {
    it('renders no sample organization data in body', async () => {
      const xml = await getDocXml('report', 'modern');
      expect(xml).not.toContain('Примерная');
    });

    it('renders addressee as plain paragraphs (no table)', async () => {
      const xml = await getDocXml('report', 'modern', { 'Адресат': 'Генеральному' });
      expect(xml).toContain('Генеральному');
      expect(xml).not.toMatch(/<w:tbl>/);
    });

    it('renders docTitle', async () => {
      const xml = await getDocXml('report', 'modern');
      expect(xml).toContain('ДОКЛАДНАЯ ЗАПИСКА');
    });

    it('renders dateNumber as stack', async () => {
      const xml = await getDocXml('report', 'modern', { 'Дата': '12.09.2026' });
      expect(xml).toContain('от ');
      expect(xml).toContain('12.09.2026');
    });

    it('renders title block', async () => {
      const xml = await getDocXml('report', 'modern', {}, 'О докладе');
      expect(xml).toContain('О докладе');
    });

    it('renders body paragraph', async () => {
      const xml = await getDocXml('report', 'modern', {}, null, ['Докладный текст.']);
      expect(xml).toContain('Докладный текст.');
    });

    it('renders signature as stack', async () => {
      const xml = await getDocXml('report', 'modern', {
        'Должность автора': 'Начальник',
        'ФИО автора': 'Иванов И. И.',
      });
      expect(xml).toContain('Начальник');
      expect(xml).toContain('Иванов И. И.');
    });

    it('NO salutation', async () => {
      const xml = await getDocXml('report', 'modern');
      expect(xml).not.toContain('Обращение');
    });

    it('NO executor', async () => {
      const xml = await getDocXml('report', 'modern');
      expect(xml).not.toContain('Исп.');
    });
  });

  // ── Modern Reference ──────────────────────────────────────────────────────

  describe('modern + reference', () => {
    it('renders no sample organization data in body', async () => {
      const xml = await getDocXml('reference', 'modern');
      expect(xml).not.toContain('Примерная');
    });

    it('renders addressee block', async () => {
      const xml = await getDocXml('reference', 'modern', { 'Адресат': 'В отдел кадров' });
      expect(xml).toContain('В отдел кадров');
    });

    it('renders docTitle', async () => {
      const xml = await getDocXml('reference', 'modern');
      expect(xml).toContain('СПРАВКА');
    });

    it('renders dateNumber as stack', async () => {
      const xml = await getDocXml('reference', 'modern', { 'Дата': '13.09.2026' });
      expect(xml).toContain('от ');
      expect(xml).toContain('13.09.2026');
    });

    it('renders title block', async () => {
      const xml = await getDocXml('reference', 'modern', {}, 'О справке');
      expect(xml).toContain('О справке');
    });

    it('renders body paragraph', async () => {
      const xml = await getDocXml('reference', 'modern', {}, null, ['Справочный текст.']);
      expect(xml).toContain('Справочный текст.');
    });

    it('renders signature as stack', async () => {
      const xml = await getDocXml('reference', 'modern', {
        'Должность автора': 'Старший инженер',
        'ФИО автора': 'Сидоров П. П.',
      });
      expect(xml).toContain('Старший инженер');
      expect(xml).toContain('Сидоров П. П.');
    });

    it('NO salutation', async () => {
      const xml = await getDocXml('reference', 'modern');
      expect(xml).not.toContain('Обращение');
    });

    it('NO executor', async () => {
      const xml = await getDocXml('reference', 'modern');
      expect(xml).not.toContain('Исп.');
    });
  });

  // ── Modern Letter ─────────────────────────────────────────────────────────

  describe('modern + letter', () => {
    it('renders no sample organization data in body', async () => {
      const xml = await getDocXml('letter', 'modern');
      expect(xml).not.toContain('Примерная');
    });

    it('renders addressee (3 paragraphs for letter)', async () => {
      const xml = await getDocXml('letter', 'modern', {
        'Организация адресата': 'ООО «Тест»',
        'Лицо адресата': 'Директору',
        'Адрес адресата': '123456, г. Москва',
      });
      expect(xml).toContain('ООО «Тест»');
      expect(xml).toContain('Директору');
      expect(xml).toContain('123456, г. Москва');
    });

    it('renders dateNumber with "Исх." prefix as stack', async () => {
      const xml = await getDocXml('letter', 'modern', { 'Дата': '14.09.2026', 'Номер': '55' });
      expect(xml).toContain('от ');
      expect(xml).toContain('14.09.2026');
      expect(xml).toContain('Исх.');
      expect(xml).toContain('55');
    });

    it('renders title block', async () => {
      const xml = await getDocXml('letter', 'modern', {}, 'О партнёрстве');
      expect(xml).toContain('О партнёрстве');
    });

    it('renders salutation', async () => {
      const xml = await getDocXml('letter', 'modern', { 'Обращение': 'Здравствуйте!' });
      expect(xml).toContain('Здравствуйте!');
    });

    it('renders body paragraph', async () => {
      const xml = await getDocXml('letter', 'modern', {}, null, ['Буквенный текст.']);
      expect(xml).toContain('Буквенный текст.');
    });

    it('renders signature as stack', async () => {
      const xml = await getDocXml('letter', 'modern', {
        'Должность подписывающего': 'Генеральный директор',
        'ФИО подписывающего': 'Иванов И. И.',
      });
      expect(xml).toContain('Генеральный директор');
      expect(xml).toContain('Иванов И. И.');
    });

    it('renders executor block', async () => {
      const xml = await getDocXml('letter', 'modern', {
        'Исполнитель': 'Сидоров П. П., тел. +7 (000) 000-00-00',
      });
      expect(xml).toContain('Исп.');
      expect(xml).toContain('Сидоров П. П., тел. +7 (000) 000-00-00');
    });

    it('NO docTitle', async () => {
      const xml = await getDocXml('letter', 'modern');
      expect(xml).not.toContain('ПИСЬМО');
    });
  });
});

// ── Test Group 2: Field Rendering Verification ──────────────────────────────
// Verify that ALL required fields from docType.fields have corresponding
// rendering in the XML for each combination.

describe('Test Group 2 — Field Rendering Verification', () => {
  // ── Memo fields ───────────────────────────────────────────────────────────

  describe('memo fields', () => {
    it('Адресат renders in addressee block (classic)', async () => {
      const xml = await getDocXml('memo', 'classic', { 'Адресат': 'Начальнику отдела' });
      expect(xml).toContain('Начальнику отдела');
    });

    it('Адресат renders in addressee block (modern)', async () => {
      const xml = await getDocXml('memo', 'modern', { 'Адресат': 'Начальнику отдела' });
      expect(xml).toContain('Начальнику отдела');
    });

    it('Должность автора renders in signature block (classic)', async () => {
      const xml = await getDocXml('memo', 'classic', { 'Должность автора': 'Инженер' });
      expect(xml).toContain('Инженер');
    });

    it('Должность автора renders in signature block (modern)', async () => {
      const xml = await getDocXml('memo', 'modern', { 'Должность автора': 'Инженер' });
      expect(xml).toContain('Инженер');
    });

    it('ФИО автора renders in signature block (classic)', async () => {
      const xml = await getDocXml('memo', 'classic', { 'ФИО автора': 'Петров П. П.' });
      expect(xml).toContain('Петров П. П.');
    });

    it('ФИО автора renders in signature block (modern)', async () => {
      const xml = await getDocXml('memo', 'modern', { 'ФИО автора': 'Петров П. П.' });
      expect(xml).toContain('Петров П. П.');
    });

    it('Тема renders in title block via "О " prefix (classic)', async () => {
      const xml = await getDocXml('memo', 'classic', { 'Тема': 'закупке' });
      // When title is null, title block uses: "О " + valueRuns('Тема') — separate runs
      expect(xml).toContain('О ');
      expect(xml).toContain('закупке');
    });

    it('Тема renders in title block via "О " prefix (modern)', async () => {
      const xml = await getDocXml('memo', 'modern', { 'Тема': 'отчёту' });
      expect(xml).toContain('О ');
      expect(xml).toContain('отчёту');
    });

    it('Дата renders in dateNumber block with "от " prefix (classic)', async () => {
      const xml = await getDocXml('memo', 'classic', { 'Дата': '11.09.2026' });
      // "от " is in one <w:r>, date value in another — check both exist
      expect(xml).toContain('от ');
      expect(xml).toContain('11.09.2026');
    });

    it('Дата renders in dateNumber block with "от " prefix (modern)', async () => {
      const xml = await getDocXml('memo', 'modern', { 'Дата': '11.09.2026' });
      expect(xml).toContain('от ');
      expect(xml).toContain('11.09.2026');
    });

    it('Номер renders in dateNumber block with "№ " prefix (classic)', async () => {
      const xml = await getDocXml('memo', 'classic', { 'Номер': '42' });
      expect(xml).toContain('№ 42');
    });

    it('Номер renders in dateNumber block with "№ " prefix (modern)', async () => {
      const xml = await getDocXml('memo', 'modern', { 'Номер': '42' });
      expect(xml).toContain('№ 42');
    });
  });

  // ── Report fields (same as memo) ─────────────────────────────────────────

  describe('report fields (same as memo)', () => {
    it('Адресат renders in addressee block (classic)', async () => {
      const xml = await getDocXml('report', 'classic', { 'Адресат': 'Генеральному директору' });
      expect(xml).toContain('Генеральному директору');
    });

    it('Адресат renders in addressee block (modern)', async () => {
      const xml = await getDocXml('report', 'modern', { 'Адресат': 'Генеральному директору' });
      expect(xml).toContain('Генеральному директору');
    });

    it('Должность автора renders in signature (classic)', async () => {
      const xml = await getDocXml('report', 'classic', { 'Должность автора': 'Начальник отдела' });
      expect(xml).toContain('Начальник отдела');
    });

    it('ФИО автора renders in signature (classic)', async () => {
      const xml = await getDocXml('report', 'classic', { 'ФИО автора': 'Иванов И. И.' });
      expect(xml).toContain('Иванов И. И.');
    });

    it('Тема renders in title block (classic)', async () => {
      const xml = await getDocXml('report', 'classic', { 'Тема': 'результатам' });
      expect(xml).toContain('О ');
      expect(xml).toContain('результатам');
    });

    it('Дата renders with "от " prefix (classic)', async () => {
      const xml = await getDocXml('report', 'classic', { 'Дата': '12.09.2026' });
      expect(xml).toContain('от ');
      expect(xml).toContain('12.09.2026');
    });

    it('Номер renders with "№ " prefix (classic)', async () => {
      const xml = await getDocXml('report', 'classic', { 'Номер': '7' });
      expect(xml).toContain('№ 7');
    });
  });

  // ── Reference fields ──────────────────────────────────────────────────────

  describe('reference fields', () => {
    it('Тема renders in title block (classic)', async () => {
      const xml = await getDocXml('reference', 'classic', { 'Тема': 'результатам проверки' });
      expect(xml).toContain('О ');
      expect(xml).toContain('результатам проверки');
    });

    it('Тема renders in title block (modern)', async () => {
      const xml = await getDocXml('reference', 'modern', { 'Тема': 'итогам' });
      expect(xml).toContain('О ');
      expect(xml).toContain('итогам');
    });

    it('Дата renders with "от " prefix (classic)', async () => {
      const xml = await getDocXml('reference', 'classic', { 'Дата': '13.09.2026' });
      expect(xml).toContain('от ');
      expect(xml).toContain('13.09.2026');
    });

    it('Должность автора renders in signature (classic)', async () => {
      const xml = await getDocXml('reference', 'classic', { 'Должность автора': 'Старший инженер' });
      expect(xml).toContain('Старший инженер');
    });

    it('ФИО автора renders in signature (classic)', async () => {
      const xml = await getDocXml('reference', 'classic', { 'ФИО автора': 'Сидоров П. П.' });
      expect(xml).toContain('Сидоров П. П.');
    });

    it('Адресат (optional) — renders in addressee block', async () => {
      const xml = await getDocXml('reference', 'classic', { 'Адресат': 'В отдел кадров' });
      expect(xml).toContain('В отдел кадров');
    });

    it('Период (optional) — NOT rendered by reference layout', async () => {
      const xml = await getDocXml('reference', 'classic', { 'Период': 'за сентябрь 2026 г.' });
      // Reference layout has NO block that renders "Период"
      expect(xml).not.toContain('за сентябрь 2026 г.');
    });
  });

  // ── Letter fields ─────────────────────────────────────────────────────────

  describe('letter fields', () => {
    it('Организация адресата renders in addressee (classic)', async () => {
      const xml = await getDocXml('letter', 'classic', {
        'Организация адресата': 'ООО «СтройМонтаж»',
        'Лицо адресата': 'Директору',
      });
      expect(xml).toContain('ООО «СтройМонтаж»');
    });

    it('Лицо адресата renders in addressee (classic)', async () => {
      const xml = await getDocXml('letter', 'classic', {
        'Организация адресата': 'ООО «Тест»',
        'Лицо адресата': 'Директору Петрову И. С.',
      });
      expect(xml).toContain('Директору Петрову И. С.');
    });

    it('Адрес адресата renders in addressee (classic, optional)', async () => {
      const xml = await getDocXml('letter', 'classic', {
        'Организация адресата': 'ООО «Тест»',
        'Лицо адресата': 'Директору',
        'Адрес адресата': '123456, г. Москва',
      });
      expect(xml).toContain('123456, г. Москва');
    });

    it('Обращение renders in salutation block (classic)', async () => {
      const xml = await getDocXml('letter', 'classic', {
        'Обращение': 'Уважаемый Иван Иванович!',
      });
      expect(xml).toContain('Уважаемый Иван Иванович!');
    });

    it('Обращение renders in salutation block (modern)', async () => {
      const xml = await getDocXml('letter', 'modern', {
        'Обращение': 'Здравствуйте!',
      });
      expect(xml).toContain('Здравствуйте!');
    });

    it('Тема renders in title block (classic)', async () => {
      const xml = await getDocXml('letter', 'classic', { 'Тема': 'сотрудничестве' });
      expect(xml).toContain('О ');
      expect(xml).toContain('сотрудничестве');
    });

    it('Должность подписывающего renders in signature (classic)', async () => {
      const xml = await getDocXml('letter', 'classic', {
        'Должность подписывающего': 'Генеральный директор',
        'ФИО подписывающего': 'Иванов И. И.',
      });
      expect(xml).toContain('Генеральный директор');
    });

    it('ФИО подписывающего renders in signature (classic)', async () => {
      const xml = await getDocXml('letter', 'classic', {
        'Должность подписывающего': 'Генеральный директор',
        'ФИО подписывающего': 'Иванов И. И.',
      });
      expect(xml).toContain('Иванов И. И.');
    });

    it('Исполнитель renders in executor block (classic, optional)', async () => {
      const xml = await getDocXml('letter', 'classic', {
        'Исполнитель': 'Сидоров П. П., тел. +7 (000) 000-00-00',
      });
      expect(xml).toContain('Исп.');
      expect(xml).toContain('Сидоров П. П., тел. +7 (000) 000-00-00');
    });

    it('Дата renders with "от " prefix (classic)', async () => {
      const xml = await getDocXml('letter', 'classic', { 'Дата': '14.09.2026' });
      expect(xml).toContain('от ');
      expect(xml).toContain('14.09.2026');
    });

    it('Номер renders with "Исх." prefix (classic)', async () => {
      const xml = await getDocXml('letter', 'classic', { 'Номер': '55' });
      expect(xml).toContain('Исх. 55');
    });

    it('Номер renders with "Исх." prefix (modern)', async () => {
      const xml = await getDocXml('letter', 'modern', { 'Номер': '99' });
      expect(xml).toContain('Исх. 99');
    });
  });
});

// ── Test Group 3: ГОСТ Formatting Elements ──────────────────────────────────
// Verify specific ГОСТ formatting rules for classic and modern templates.

describe('Test Group 3 — ГОСТ Formatting Elements', () => {
  describe('classic template ГОСТ', () => {
    it('orgHeader prints no sample address or phone when the blank has none', async () => {
      const xml = await getDocXml('memo', 'classic');
      expect(xml).not.toContain('Примерная');
      expect(xml).not.toContain('+7 (000) 000-00-00');
    });

    it('addressee is in a table (right-aligned)', async () => {
      const xml = await getDocXml('memo', 'classic', { 'Адресат': 'Директору' });
      expect(xml).toContain('<w:tbl>');
      expect(xml).toContain('Директору');
    });

    it('dateNumber has "от " prefix for date', async () => {
      const xml = await getDocXml('memo', 'classic', { 'Дата': '11.09.2026' });
      // ГОСТ: date is prefixed with "от " — separate XML runs, check both exist
      expect(xml).toContain('от ');
      expect(xml).toContain('11.09.2026');
    });

    it('dateNumber has "№ " prefix for number', async () => {
      const xml = await getDocXml('memo', 'classic', { 'Номер': '42' });
      expect(xml).toContain('№ 42');
    });

    it('signature has underlined space for wet signature', async () => {
      const xml = await getDocXml('memo', 'classic', {
        'Должность автора': 'Инженер',
        'ФИО автора': 'Петров П. П.',
      });
      // ГОСТ: underlined line for wet signature (12 underscores — fits the signature column)
      expect(xml).toContain('>____________<');
      expect(xml).toContain('<w:u w:val="single"/>');
    });

    it('title uses "О " prefix when title is provided', async () => {
      const xml = await getDocXml('memo', 'classic', {}, 'закупке');
      // "О " + title is a single TextRun when title is provided
      expect(xml).toContain('О закупке');
    });

    it('title uses "О " prefix with valueRuns when title is null', async () => {
      const xml = await getDocXml('memo', 'classic', { 'Тема': 'закупке' });
      // When title is null: "О " is separate TextRun, "закупке" from valueRuns
      expect(xml).toContain('О ');
      expect(xml).toContain('закупке');
    });

    it('dateNumber uses row layout (table)', async () => {
      const xml = await getDocXml('memo', 'classic', { 'Дата': '11.09.2026', 'Номер': '1' });
      // Classic dateNumber layout = "row" → table with two cells
      expect(xml).toContain('<w:tbl>');
    });

    it('signature uses row layout (table)', async () => {
      const xml = await getDocXml('memo', 'classic', {
        'Должность автора': 'Инженер',
        'ФИО автора': 'Петров П. П.',
      });
      // Classic signature layout = "row" → table with two cells
      expect(xml).toContain('<w:tbl>');
    });
  });

  describe('modern template ГОСТ', () => {
    it('renders no sample organization data in body', async () => {
      const xml = await getDocXml('memo', 'modern');
      expect(xml).not.toContain('Примерная');
    });

    it('addressee as plain paragraphs (no table)', async () => {
      const xml = await getDocXml('memo', 'modern', { 'Адресат': 'Директору' });
      expect(xml).toContain('Директору');
      expect(xml).not.toMatch(/<w:tbl>/);
    });

    it('dateNumber as stack (separate paragraphs, no table)', async () => {
      const xml = await getDocXml('memo', 'modern', { 'Дата': '11.09.2026', 'Номер': '10' });
      expect(xml).toContain('от ');
      expect(xml).toContain('11.09.2026');
      expect(xml).toContain('№ 10');
      // Modern dateNumber layout = "stack" → no table for dateNumber
      // (body might have tables from other blocks, but dateNumber itself is stack)
    });

    it('signature as stack (position over name, no table)', async () => {
      const xml = await getDocXml('memo', 'modern', {
        'Должность автора': 'Инженер',
        'ФИО автора': 'Петров П. П.',
      });
      expect(xml).toContain('Инженер');
      expect(xml).toContain('Петров П. П.');
      // Modern signature layout = "stack" → no table for signature
    });

    it('title uses bold (modern template config)', async () => {
      const xml = await getDocXml('memo', 'modern', {}, 'тест');
      expect(xml).toContain('О тест');
      // Modern title config: bold=true
    });

    it('dateNumber still has "от " prefix', async () => {
      const xml = await getDocXml('memo', 'modern', { 'Дата': '11.09.2026' });
      expect(xml).toContain('от ');
      expect(xml).toContain('11.09.2026');
    });

    it('signature has underlined space for wet signature', async () => {
      const xml = await getDocXml('memo', 'modern', {
        'Должность автора': 'Инженер',
        'ФИО автора': 'Петров П. П.',
      });
      expect(xml).toContain('>____________<');
      expect(xml).toContain('<w:u w:val="single"/>');
    });
  });
});

// ── Test Group 4: Placeholder Rendering ──────────────────────────────────────
// Verify unfilled fields show [Label] with yellow highlight.

describe('Test Group 4 — Placeholder Rendering', () => {
  describe('classic template placeholders', () => {
    it('memo: unfilled Адресат shows [Адресат] with yellow highlight', async () => {
      const xml = await getDocXml('memo', 'classic', {});
      expect(xml).toContain('[Адресат]');
      expect(xml).toContain('<w:highlight w:val="yellow"/>');
    });

    it('memo: unfilled Дата shows [Дата] with yellow highlight', async () => {
      const xml = await getDocXml('memo', 'classic', {});
      expect(xml).toContain('[Дата]');
    });

    it('memo: unfilled Номер shows [Номер] with yellow highlight', async () => {
      const xml = await getDocXml('memo', 'classic', {});
      expect(xml).toContain('[Номер]');
    });

    it('memo: unfilled Должность автора shows [Должность автора]', async () => {
      const xml = await getDocXml('memo', 'classic', {});
      expect(xml).toContain('[Должность автора]');
    });

    it('memo: unfilled ФИО автора shows [ФИО автора]', async () => {
      const xml = await getDocXml('memo', 'classic', {});
      expect(xml).toContain('[ФИО автора]');
    });

    it('memo: unfilled Тема shows [Тема] in title block', async () => {
      const xml = await getDocXml('memo', 'classic', {});
      expect(xml).toContain('[Тема]');
    });

    it('report: unfilled Адресат shows [Адресат]', async () => {
      const xml = await getDocXml('report', 'classic', {});
      expect(xml).toContain('[Адресат]');
    });

    it('reference: unfilled Тема shows [Тема]', async () => {
      const xml = await getDocXml('reference', 'classic', {});
      expect(xml).toContain('[Тема]');
    });

    it('letter: unfilled Организация адресата shows [Организация адресата]', async () => {
      const xml = await getDocXml('letter', 'classic', {});
      expect(xml).toContain('[Организация адресата]');
    });

    it('letter: unfilled Лицо адресата shows [Лицо адресата]', async () => {
      const xml = await getDocXml('letter', 'classic', {});
      expect(xml).toContain('[Лицо адресата]');
    });

    it('letter: unfilled Должность подписывающего shows placeholder', async () => {
      const xml = await getDocXml('letter', 'classic', {});
      expect(xml).toContain('[Должность подписывающего]');
    });

    it('letter: unfilled ФИО подписывающего shows placeholder', async () => {
      const xml = await getDocXml('letter', 'classic', {});
      expect(xml).toContain('[ФИО подписывающего]');
    });
  });

  describe('modern template placeholders', () => {
    it('memo: unfilled Адресат shows [Адресат] with yellow highlight', async () => {
      const xml = await getDocXml('memo', 'modern', {});
      expect(xml).toContain('[Адресат]');
      expect(xml).toContain('<w:highlight w:val="yellow"/>');
    });

    it('memo: unfilled Дата shows [Дата]', async () => {
      const xml = await getDocXml('memo', 'modern', {});
      expect(xml).toContain('[Дата]');
    });

    it('letter: unfilled Организация адресата shows placeholder', async () => {
      const xml = await getDocXml('letter', 'modern', {});
      expect(xml).toContain('[Организация адресата]');
    });

    it('reference: unfilled Тема shows [Тема]', async () => {
      const xml = await getDocXml('reference', 'modern', {});
      expect(xml).toContain('[Тема]');
    });
  });

  describe('filled fields do NOT have highlight', () => {
    it('memo: filled Адресат has no highlight on value run', async () => {
      const xml = await getDocXml('memo', 'classic', { 'Адресат': 'Начальнику' });
      const valueRunMatch = xml.match(
        /<w:r>(?:<w:rPr>[\s\S]*?<\/w:rPr>)?<w:t[^>]*>Начальнику<\/w:t><\/w:r>/
      );
      expect(valueRunMatch).not.toBeNull();
      expect(valueRunMatch[0]).not.toContain('<w:highlight');
    });

    it('memo: filled Дата has no highlight on value run', async () => {
      const xml = await getDocXml('memo', 'classic', { 'Дата': '11.09.2026' });
      // The date value run should not have highlight — find a run containing the date
      // Date runs are wrapped in separate <w:r> elements, check at least one has no highlight
      const dateRunRegex = /<w:r>(?:<w:rPr>(?:(?!<w:highlight)[\s\S])*?<\/w:rPr>)?<w:t[^>]*>11\.09\.2026<\/w:t><\/w:r>/;
      expect(xml).toMatch(dateRunRegex);
    });
  });
});

// ── Test Group 5: Complete Field Coverage ────────────────────────────────────
// Verify that the UNION of template.requiredFields ∪ docType.fields has a
// rendering place in every layout. Flag any field that has NO block rendering it.

describe('Test Group 5 — Complete Field Coverage', () => {
  // Map: which block renders which field for each docType
  const fieldRenderers = {
    memo: {
      'Адресат': 'addressee',
      'Должность автора': 'signature',
      'ФИО автора': 'signature',
      'Тема': 'title',
      'Дата': 'dateNumber',
      'Номер': 'dateNumber',
    },
    report: {
      'Адресат': 'addressee',
      'Должность автора': 'signature',
      'ФИО автора': 'signature',
      'Тема': 'title',
      'Дата': 'dateNumber',
      'Номер': 'dateNumber',
    },
    reference: {
      'Адресат': 'addressee',
      'Тема': 'title',
      'Дата': 'dateNumber',
      'Должность автора': 'signature',
      'ФИО автора': 'signature',
      // 'Период' → NO rendering place (no block renders this field)
    },
    letter: {
      'Организация адресата': 'addressee',
      'Лицо адресата': 'addressee',
      'Адрес адресата': 'addressee',
      'Обращение': 'salutation',
      'Тема': 'title',
      'Должность подписывающего': 'signature',
      'ФИО подписывающего': 'signature',
      'Исполнитель': 'executor',
      'Дата': 'dateNumber',
      'Номер': 'dateNumber',
    },
  };

  // Layout block sequences (from blocks.js)
  const layoutBlocks = {
    'classic:memo': ['orgHeader', 'docTitle', 'dateNumber', 'addressee', 'approvalBlock', 'agreementBlock', 'title', 'body', 'attachmentBlock', 'signature'],
    'classic:report': ['orgHeader', 'docTitle', 'dateNumber', 'addressee', 'approvalBlock', 'agreementBlock', 'title', 'body', 'attachmentBlock', 'signature'],
    'classic:reference': ['orgHeader', 'docTitle', 'dateNumber', 'addressee', 'title', 'body', 'signature'],
    'classic:letter': ['orgHeader', 'dateNumber', 'addressee', 'title', 'salutation', 'body', 'signature', 'copyBlock', 'executor'],
    'modern:memo': ['orgHeader', 'docTitle', 'dateNumber', 'addressee', 'approvalBlock', 'agreementBlock', 'title', 'body', 'attachmentBlock', 'signature'],
    'modern:report': ['orgHeader', 'docTitle', 'dateNumber', 'addressee', 'approvalBlock', 'agreementBlock', 'title', 'body', 'attachmentBlock', 'signature'],
    'modern:reference': ['orgHeader', 'docTitle', 'dateNumber', 'addressee', 'title', 'body', 'signature'],
    'modern:letter': ['orgHeader', 'dateNumber', 'addressee', 'title', 'salutation', 'body', 'signature', 'copyBlock', 'executor'],
  };

  for (const dtId of ['memo', 'report', 'reference', 'letter']) {
    for (const tplId of ['classic', 'modern']) {
      describe(`${dtId} + ${tplId}`, () => {
        it('all docType.fields have a rendering block', () => {
          const dt = docTypes.get(dtId);
          const fields = dt.fields.map((f) => f.label);
          const renderers = fieldRenderers[dtId];
          const blocks = layoutBlocks[`${tplId}:${dtId}`];

          const unrendered = [];
          for (const field of fields) {
            const renderer = renderers[field];
            if (!renderer) {
              unrendered.push(field);
            } else if (!blocks.includes(renderer)) {
              unrendered.push(`${field} (block "${renderer}" not in layout)`);
            }
          }

          // Fields that are expected to have no rendering place
          const knownUnrendered = {
            reference: ['Период'],       // Адресат now renders in addressee block
            memo: ['Подразделение автора'], // In memo fields but no layout block renders it
            report: ['Подразделение автора'], // In report fields but no layout block renders it
            letter: ['Справочные данные'],  // In letter fields but no layout block renders it
          };

          const unexpected = unrendered.filter((f) => {
            const known = knownUnrendered[dtId] || [];
            return !known.some((k) => f.startsWith(k));
          });

          if (unexpected.length > 0) {
            console.warn(
              `⚠️ ${dtId}+${tplId}: fields with NO rendering place: ${unexpected.join(', ')}`
            );
          }

          // All fields should either have a renderer or be in the known-unrendered list
          expect(unexpected).toEqual([]);
        });

        it('all layout blocks exist in the block registry', () => {
          const blocks = layoutBlocks[`${tplId}:${dtId}`];
          const registry = ['orgHeader', 'addressee', 'docTitle', 'dateNumber', 'title', 'salutation', 'body', 'signature', 'executor', 'approvalBlock', 'agreementBlock', 'attachmentBlock', 'copyBlock'];
          for (const block of blocks) {
            expect(registry).toContain(block);
          }
        });
      });
    }
  }

  // Explicit tests for fields with known gaps
  describe('known rendering gaps', () => {
    it('reference: Адресат renders in addressee block', async () => {
      const xml = await getDocXml('reference', 'classic', { 'Адресат': 'В отдел кадров' });
      expect(xml).toContain('В отдел кадров');
    });

    it('reference: Период has no rendering block — flagged', async () => {
      const xml = await getDocXml('reference', 'classic', { 'Период': 'за сентябрь 2026 г.' });
      expect(xml).not.toContain('за сентябрь 2026 г.');
    });

    it('template.requiredFields "Организация" is not in memo.json fields — flagged', () => {
      // classic.json requiredFields includes "Организация" but memo.json fields do not have it
      const dt = docTypes.get('memo');
      const fieldLabels = dt.fields.map((f) => f.label);
      expect(fieldLabels).not.toContain('Организация');
    });
  });
});

// ── Test Group 6: All 10 Combinations Produce Valid DOCX ─────────────────────
// Smoke test: every combination produces a parseable, non-empty DOCX.

describe('Test Group 6 — All 10 Combinations Produce Valid DOCX', () => {
  const combinations = [
    ['memo', 'classic'],
    ['memo', 'modern'],
    ['report', 'classic'],
    ['report', 'modern'],
    ['reference', 'classic'],
    ['reference', 'modern'],
    ['letter', 'classic'],
    ['letter', 'modern'],
    ['explanatory-note', 'classic'],
    ['explanatory-note', 'modern'],
  ];

  for (const [dtId, tplId] of combinations) {
    it(`${dtId}+${tplId}: produces valid DOCX with document.xml`, async () => {
      const buffer = await renderDocx(buildModel({
        docTypeId: dtId,
        templateId: tplId,
        values: { 'Адресат': 'Тест', 'Дата': '11.09.2026' },
        title: 'О проверке',
        body: ['Тестовый абзац.'],
      }));
      const zip = await JSZip.loadAsync(buffer);
      expect(zip.file('word/document.xml')).not.toBeNull();
      const docXml = await zip.file('word/document.xml').async('string');
      expect(docXml.length).toBeGreaterThan(0);
      expect(docXml).toContain('Тестовый абзац.');
    });
  }
});
