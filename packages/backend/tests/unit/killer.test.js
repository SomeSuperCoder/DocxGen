import { describe, expect, it } from 'vitest';
import { checkGost, detectDocumentType, formatDirectorySuggestion, normalizeRussianDate, normalizeRussianRequisite } from '../../src/features/killer.js';

describe('product extensions', () => {
  it('suggests a document type with evidence', () => {
    const result = detectDocumentType('Докладываю о нарушении срока поставки', [{ id: 'report', name: 'Докладная записка' }]);
    expect(result.typeId).toBe('report');
    expect(result.evidence.length).toBeGreaterThan(0);
  });

  it('normalizes spoken Russian dates', () => {
    expect(normalizeRussianDate('двадцать пятое сентября')).toMatch(/^25\.09\.\d{4}$/);
  });

  it('normalizes a spoken full name to initials', () => {
    expect(normalizeRussianRequisite('ФИО автора', 'Иванов Иван Иванович')).toBe('Иванов И. И.');
  });

  it('formats a directory match for a requisites field', () => {
    expect(formatDirectorySuggestion({ name: 'Иванов Иван Иванович', position: 'Генеральный директор' })).toBe('Генеральному директору Иванову И. И.');
  });

  it('returns a transparent GOST checklist', () => {
    const report = checkGost({ template: { organization: { name: 'ООО Ромашка' }, autoFill: { date: true } }, title: 'О закупке', body: ['Текст'], userFields: { Адресат: 'Иванову', 'ФИО автора': 'Петров П. П.' } });
    expect(report.standard).toContain('ГОСТ');
    expect(report.checks.find((check) => check.id === 'title').ok).toBe(true);
  });
});
