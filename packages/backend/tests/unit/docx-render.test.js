import { describe, it, expect } from 'vitest';
import { renderDocx } from '../../src/docx/render.js';
import { mergeRequisites } from '../../src/validation/requisites.js';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';

// ── Load actual config files ─────────────────────────────────────────────────

const memoDocType = JSON.parse(
  readFileSync(new URL('../../config/doc-types/memo.json', import.meta.url), 'utf8'),
);
const classicTemplate = JSON.parse(
  readFileSync(new URL('../../config/templates/classic.json', import.meta.url), 'utf8'),
);

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Extract plain text from a DOCX buffer by parsing word/document.xml. */
async function extractText(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const docXml = await zip.file('word/document.xml').async('string');
  return docXml;
}

// ── Pipeline: mergeRequisites → renderDocx ───────────────────────────────────

describe('DOCX render pipeline — mergeRequisites → renderDocx', () => {
  // ── Test 1: AI-filled values appear in the rendered DOCX ───────────────────

  it('aiField values appear in rendered DOCX', async () => {
    const aiFields = {
      'Адресат': { value: 'Иванов И.И.', quote: '' },
      'Должность автора': { value: 'Ведущий инженер', quote: '' },
      'ФИО автора': { value: 'Сидоров П.П.', quote: '' },
    };

    const { values } = mergeRequisites({
      docType: memoDocType,
      template: classicTemplate,
      aiFields,
      title: null,
      userFields: {},
      today: '2026-09-12',
    });

    const buffer = await renderDocx({
      docType: memoDocType,
      template: classicTemplate,
      values,
      title: null,
      body: ['Тестовый текст.'],
    });

    // Buffer is a valid DOCX (ZIP with word/document.xml)
    expect(buffer).toBeInstanceOf(Buffer);
    const docXml = await extractText(buffer);
    expect(docXml.length).toBeGreaterThan(0);

    // AI-filled values must appear in the rendered XML
    expect(docXml).toContain('Иванов И.И.');
    expect(docXml).toContain('Ведущий инженер');
    expect(docXml).toContain('Сидоров П.П.');

    // Body text also present
    expect(docXml).toContain('Тестовый текст.');
  });

  // ── Test 2: Null values render as [Label] placeholders ─────────────────────

  it('null values show as [Label] placeholder', async () => {
    // Pass no AI fields and skip 'Адресат' via userFields=null → placeholder [Адресат]
    const { values } = mergeRequisites({
      docType: memoDocType,
      template: classicTemplate,
      aiFields: {},
      title: null,
      userFields: { 'Адресат': null },
      today: '2026-09-12',
    });

    // Confirm mergeRequisites produced null for Адресат
    expect(values['Адресат'].value).toBeNull();

    const buffer = await renderDocx({
      docType: memoDocType,
      template: classicTemplate,
      values,
      title: null,
      body: [],
    });

    const docXml = await extractText(buffer);

    // valueRuns renders null → "[Адресат]" with yellow highlight
    expect(docXml).toContain('[Адресат]');
    expect(docXml).toContain('<w:highlight w:val="yellow"/>');

    // 'Номер' is registry-kind → always placeholder
    expect(docXml).toContain('[Номер]');

    // 'Тема' with null value → "[Тема]"
    expect(docXml).toContain('[Тема]');
  });

  // ── Test 3: Mixed — some values, some placeholders ─────────────────────────

  it('mixed values and placeholders', async () => {
    const aiFields = {
      'Адресат': { value: 'Петрову И.С.', quote: '' },
    };

    // 'ФИО автора' is NOT provided → should show as placeholder
    const { values } = mergeRequisites({
      docType: memoDocType,
      template: classicTemplate,
      aiFields,
      title: 'О закупке',
      userFields: {},
      today: '2026-09-12',
    });

    // Verify the merge state
    expect(values['Адресат'].value).toBe('Петрову И.С.');
    expect(values['Должность автора'].value).toBeNull(); // not provided
    expect(values['ФИО автора'].value).toBeNull(); // not provided
    expect(values['Тема'].value).toBe('О закупке'); // from title param

    const buffer = await renderDocx({
      docType: memoDocType,
      template: classicTemplate,
      values,
      title: 'О закупке',
      body: ['Содержимое записки.'],
    });

    const docXml = await extractText(buffer);

    // Value present as plain text (no highlight)
    expect(docXml).toContain('Петрову И.С.');
    // ValueRun with data must NOT have a highlight run
    const valueRun = docXml.match(
      /<w:r>(?:<w:rPr>[\s\S]*?<\/w:rPr>)?<w:t[^>]*>Петрову И\.С\.<\/w:t><\/w:r>/,
    );
    expect(valueRun).not.toBeNull();
    expect(valueRun[0]).not.toContain('<w:highlight');

    // Null fields show as [Label] with highlight
    expect(docXml).toContain('[Должность автора]');
    expect(docXml).toContain('[ФИО автора]');
    expect(docXml).toContain('<w:highlight w:val="yellow"/>');

    // Auto-filled date (today 2026-09-12 → "12 сентября 2026 г.")
    expect(docXml).toContain('12 сентября 2026 г.');

    // Registry field always placeholder
    expect(docXml).toContain('[Номер]');

    // Title rendered as "О закупке" (title param provided)
    expect(docXml).toContain('О закупке');

    // Body present
    expect(docXml).toContain('Содержимое записки.');
  });
});
