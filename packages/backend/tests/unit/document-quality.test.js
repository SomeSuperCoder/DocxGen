import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { processDraft } from '../../src/ai/processDraft.js';
import { buildMessages } from '../../src/ai/prompt.js';
import { loadDocTypes } from '../../src/catalog/docTypes.js';
import { loadTemplates } from '../../src/catalog/templates.js';
import { mergeRequisites } from '../../src/validation/requisites.js';
import { renderDocx } from '../../src/docx/render.js';
import { stripMarkup } from '../../src/validation/normalize.js';

const docTypes = loadDocTypes('./config/doc-types');
const templates = loadTemplates('./config/templates', { error: () => {}, warn: () => {} });
const memo = docTypes.get('memo');

const DRAFT = 'прошу выделить средства на закупку 5 мониторов для отдела разработки. текущие мониторы 2016 года, у трех из них битые пиксели и мерцание. директору иванову и.и. от петрова п.п.';

// Реальный ответ модели, из-за которого в DOCX попали теги и пустые реквизиты.
const RAW_AI_ANSWER = JSON.stringify({
  title: 'О выделении средств на закупку мониторов для отдела разработки',
  body: [
    '<b>Прошу выделить средства на закупку 5 мониторов для отдела разработки.</b>',
    'Текущие мониторы <b>2016 года</b> выпуска, у трёх из них обнаружены <b>битые пиксели и мерцание</b>.',
  ],
  fields: {
    addressee: { value: 'Директору Иванову И.И.', quote: 'директору иванову и.и.' },
    authorDepartment: { value: 'Отдел разработки', quote: 'отдела разработки' },
    authorPosition: null,
    authorName: { value: 'Петров П.П.', quote: 'от петрова п.п.' },
    subject: { value: 'О выделении средств на закупку мониторов', quote: 'прошу выделить средства на закупку 5 мониторов' },
  },
  changes: ['Применено форматирование: выделены <b>жирным</b> ключевые данные'],
});

const provider = (raw) => ({ name: 'test', complete: async () => raw });

async function docXml(model) {
  const zip = await JSZip.loadAsync(await renderDocx(model));
  return zip.file('word/document.xml').async('string');
}

function memoModel({ values = {}, title = null, body = ['Текст.'], templateId = 'classic' } = {}) {
  const { template } = templates.get(templateId);
  const merged = mergeRequisites({ docType: memo, template, aiFields: {}, title, userFields: values, today: '2026-09-13' });
  return { docType: memo, template, values: merged.values, title, body };
}

describe('stripMarkup', () => {
  it('removes HTML tags and markdown emphasis but keeps comparison signs', () => {
    expect(stripMarkup('<b>Прошу</b> <i>срочно</i> <u>ст. 136</u>')).toBe('Прошу срочно ст. 136');
    expect(stripMarkup('**важно** и __тоже__')).toBe('важно и тоже');
    expect(stripMarkup('стаж < 5 лет и > 2')).toBe('стаж < 5 лет и > 2');
  });
});

describe('AI prompt', () => {
  it('forbids markup and names the exact field keys of the doc type', () => {
    const [system] = buildMessages({ draft: DRAFT, docType: memo });
    expect(system.content).not.toMatch(/ДОЛЖЕН применять форматирование/);
    expect(system.content).toMatch(/без HTML-тегов/);
    expect(system.content).toContain('"Адресат"');
    expect(system.content).toContain('"ФИО автора"');
  });
});

describe('processDraft output', () => {
  it('returns plain text without tags', async () => {
    const result = await processDraft({ draft: DRAFT, docType: memo, userFields: {}, provider: provider(RAW_AI_ANSWER) });
    expect(result.body.join('\n')).not.toMatch(/<\/?b>/);
    expect(result.body[0]).toBe('Прошу выделить средства на закупку 5 мониторов для отдела разработки.');
    expect(result.changes.join()).not.toMatch(/<\/?b>/);
  });

  it('maps English field keys to the doc type keys', async () => {
    const result = await processDraft({ draft: DRAFT, docType: memo, userFields: {}, provider: provider(RAW_AI_ANSWER) });
    expect(result.aiFields['Адресат']?.value).toBe('Директору Иванову И.И.');
    expect(result.aiFields['ФИО автора']?.value).toBe('Петров П.П.');
    expect(result.aiFields['Наименование подразделения']?.value).toBe('Отдел разработки');
    expect(result.aiFields['Тема']?.value).toBe('О выделении средств на закупку мониторов');
  });
});

describe('AI answer tolerance', () => {
  it('accepts a derived field without a quote and flags an extracted field without one', async () => {
    const raw = JSON.stringify({
      title: 'О закупке мониторов',
      body: ['Прошу выделить средства.'],
      fields: {
        'Тема': { value: 'О закупке мониторов', quote: null },
        'Адресат': { value: 'Директору Сидорову С. С.', quote: null },
        'ФИО автора': { value: '', quote: '' },
      },
      changes: [],
    });
    const result = await processDraft({ draft: DRAFT, docType: memo, userFields: {}, provider: provider(raw) });
    expect(result.aiFields['Тема'].value).toBe('О закупке мониторов');
    expect(result.aiFields['Адресат'].ungrounded).toBe(true);
    expect(result.aiFields['ФИО автора'] ?? null).toBeNull();
  });
});

describe('document subject', () => {
  it('takes the «О …» title for Тема when the model returns the subject in the nominative case', async () => {
    const raw = JSON.stringify({
      title: 'О закупке мониторов для отдела разработки',
      body: ['Прошу выделить средства.'],
      fields: { 'Тема': { value: 'Закупка 5 мониторов для отдела разработки', quote: null } },
      changes: [],
    });
    const result = await processDraft({ draft: DRAFT, docType: memo, userFields: {}, provider: provider(raw) });
    expect(result.aiFields['Тема'].value).toBe('О закупке мониторов для отдела разработки');
  });

  it('writes the word after «О» in lower case', async () => {
    const xml = await docXml(memoModel({ values: { 'Тема': 'Закупка мониторов' } }));
    expect(xml).toContain('О закупке мониторов');
    const acronym = await docXml(memoModel({ values: { 'Тема': 'О ГОСТ Р 7.0.97' } }));
    expect(acronym).toContain('О ГОСТ Р 7.0.97');
  });
});

describe('DOCX structure', () => {
  it('does not double the «О» of the title when the subject already starts with it', async () => {
    const xml = await docXml(memoModel({ values: { 'Тема': 'О выделении средств' }, title: 'Документ' }));
    expect(xml).not.toMatch(/>О <\/w:t>.*>О выделении/s);
    expect(xml).toContain('О выделении средств');
  });

  it('lists every highlighted field as a placeholder, including required ones', () => {
    const { template } = templates.get('classic');
    const { placeholders } = mergeRequisites({ docType: memo, template, aiFields: {}, title: null, userFields: {}, today: '2026-09-13' });
    expect(placeholders).toEqual(expect.arrayContaining(['Адресат', 'Должность автора', 'ФИО автора', 'Номер']));
  });

  it('never writes raw line feeds or sample organization data into the text', async () => {
    const xml = await docXml(memoModel({ values: { 'Наименование подразделения': 'Отдел разработки' } }));
    expect(xml).not.toMatch(/<w:t[^>]*>[^<]*\n/);
    expect(xml).not.toContain('Примерная');
    expect(xml).not.toContain('000-00-00');
  });

  it('lays out requisite tables at full page width without visible borders', async () => {
    const xml = await docXml(memoModel({ values: { 'Адресат': 'Директору Иванову И. И.' } }));
    const tables = xml.match(/<w:tbl>.*?<\/w:tbl>/gs) ?? [];
    expect(tables.length).toBeGreaterThan(0);
    for (const table of tables) {
      expect(table).toMatch(/<w:tblW w:type="pct" w:w="(100%|5000)"\/>/);
      expect(table).toContain('<w:tblLayout w:type="fixed"/>');
      expect(table.match(/<w:tblBorders>.*?<\/w:tblBorders>/s)[0]).not.toContain('w:val="single"');
    }
  });

  it('puts position, signature line and name on one row in the classic signature', async () => {
    const xml = await docXml(memoModel({ values: { 'Должность автора': 'Ведущий инженер', 'ФИО автора': 'Петров П. П.' } }));
    const signature = (xml.match(/<w:tbl>.*?<\/w:tbl>/gs) ?? []).find((t) => t.includes('Ведущий инженер'));
    expect(signature).toBeDefined();
    const cells = signature.match(/<w:tc>.*?<\/w:tc>/gs);
    expect(cells).toHaveLength(3);
    expect(cells[0]).toContain('Ведущий инженер');
    expect(cells[1]).toContain('____');
    expect(cells[2]).toContain('Петров П. П.');
  });

  it('keeps the signature line short enough not to wrap inside its column', async () => {
    const xml = await docXml(memoModel({ values: { 'Должность автора': 'Ведущий инженер', 'ФИО автора': 'Петров П. П.' } }));
    const line = xml.match(/_{3,}/g);
    expect(line).toHaveLength(1);
    // 25% of a 165 mm column is 41 mm; one «_» of Times New Roman 14 pt is ~2.5 mm
    expect(line[0].length).toBeLessThanOrEqual(14);
  });

  it('aligns the addressee to the right edge of the page', async () => {
    const xml = await docXml(memoModel({ values: { 'Адресат': 'Директору Иванову И. И.' } }));
    const addressee = (xml.match(/<w:tbl>.*?<\/w:tbl>/gs) ?? []).find((t) => t.includes('Директору Иванову'));
    const paragraph = addressee.match(/<w:p>(?:(?!<\/w:p>).)*Директору Иванову.*?<\/w:p>/s)[0];
    expect(paragraph).toContain('<w:jc w:val="right"/>');
  });
});
