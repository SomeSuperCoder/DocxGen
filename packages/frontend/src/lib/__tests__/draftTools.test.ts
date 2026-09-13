import { describe, expect, it } from 'vitest';
import {
  analyzeDraft,
  applyStyleFix,
  applyAllStyleFixes,
  buildEmailText,
  findStyleIssues,
  loadSavedDraft,
  saveDraft,
  clearSavedDraft,
  matchHotkey,
} from '../draftTools';

const MEMO = 'Директору Иванову И. И. Прошу выделить средства на закупку 5 мониторов для отдела разработки: у трёх из них битые пиксели. От Петрова П. П.';

describe('analyzeDraft', () => {
  it('marks a complete memo draft as ready', () => {
    const report = analyzeDraft(MEMO, 'memo');
    expect(report.checks.every((check) => check.ok)).toBe(true);
    expect(report.score).toBe(report.total);
  });

  it('explains what a casual message is missing', () => {
    const report = analyzeDraft('привет как дела красавчик', 'memo');
    const failed = report.checks.filter((check) => !check.ok).map((check) => check.id);
    expect(failed).toEqual(expect.arrayContaining(['essence', 'addressee', 'author', 'facts', 'length', 'tone']));
    expect(report.checks.find((check) => check.id === 'addressee')?.hint).toMatch(/Кому/);
  });

  it('does not ask an order or a protocol for an addressee', () => {
    expect(analyzeDraft(MEMO, 'order').checks.map((check) => check.id)).not.toContain('addressee');
    expect(analyzeDraft(MEMO, 'protocol').checks.map((check) => check.id)).not.toContain('addressee');
  });
});

describe('style fixes', () => {
  it('finds colloquial words with a business replacement', () => {
    const issues = findStyleIssues('Привет, короче надо срочно купить комп, старый сломался.');
    expect(issues.map((issue) => [issue.word, issue.replacement])).toEqual([
      ['Привет', ''],
      ['короче', ''],
      ['надо', 'необходимо'],
      ['комп', 'компьютер'],
      ['сломался', 'вышел из строя'],
    ]);
  });

  it('does not match parts of longer words', () => {
    expect(findStyleIssues('компания надомная')).toEqual([]);
  });

  it('replaces one word keeping the capital letter, and removes fillers with their comma', () => {
    const text = 'Надо купить комп.';
    expect(applyStyleFix(text, findStyleIssues(text)[0])).toBe('Необходимо купить комп.');
    const withFiller = 'Привет, короче надо купить.';
    expect(applyAllStyleFixes(withFiller)).toBe('Необходимо купить.');
  });
});

describe('buildEmailText', () => {
  it('assembles subject, addressee, text and signature, skipping empty parts', () => {
    const text = buildEmailText('Прошу выделить средства.\nМониторы устарели.', {
      'Тема': 'О закупке мониторов',
      'Адресат': 'Директору Иванову И. И.',
      'Должность автора': 'Ведущий инженер',
      'ФИО автора': 'Петров П. П.',
      'Номер': '',
    });
    expect(text).toBe('Тема: О закупке мониторов\nКому: Директору Иванову И. И.\n\nПрошу выделить средства.\n\nМониторы устарели.\n\nВедущий инженер\nПетров П. П.');
    expect(buildEmailText('Текст.', {})).toBe('Текст.');
  });
});

describe('draft autosave', () => {
  it('saves, loads and clears the draft; ignores broken storage', () => {
    clearSavedDraft();
    expect(loadSavedDraft()).toBeNull();
    saveDraft({ text: 'Черновик', documentType: 'letter', templateId: 'modern' }, new Date('2026-09-13T10:00:00Z'));
    expect(loadSavedDraft()).toEqual({ text: 'Черновик', documentType: 'letter', templateId: 'modern', savedAt: '2026-09-13T10:00:00.000Z' });
    localStorage.setItem('docxgen-draft', '{broken');
    expect(loadSavedDraft()).toBeNull();
    clearSavedDraft();
    expect(localStorage.getItem('docxgen-draft')).toBeNull();
  });
});

describe('matchHotkey', () => {
  const key = (init: Partial<KeyboardEvent>) => ({ key: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...init }) as KeyboardEvent;
  it('recognises Ctrl/⌘+Enter and Ctrl/⌘+S only', () => {
    expect(matchHotkey(key({ key: 'Enter', ctrlKey: true }))).toBe('primary');
    expect(matchHotkey(key({ key: 'Enter', metaKey: true }))).toBe('primary');
    expect(matchHotkey(key({ key: 's', ctrlKey: true }))).toBe('download');
    expect(matchHotkey(key({ key: 'ы', ctrlKey: true }))).toBe('download');
    expect(matchHotkey(key({ key: 'Enter' }))).toBeNull();
    expect(matchHotkey(key({ key: 's', ctrlKey: true, shiftKey: true }))).toBeNull();
  });
});
