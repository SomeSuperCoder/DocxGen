/**
 * Browser-only helpers for the document editor: draft readiness, business-style fixes,
 * e-mail export, draft autosave and hotkeys. Nothing here talks to the backend.
 */
import type { DocumentTypeId, Requisites } from '@/types/document';

// ── Draft readiness ─────────────────────────────────────────────────────────

export interface ReadinessCheck {
  id: 'essence' | 'addressee' | 'author' | 'facts' | 'length' | 'tone';
  label: string;
  ok: boolean;
  /** What to add when the check fails. */
  hint: string;
}

export interface ReadinessReport {
  checks: ReadinessCheck[];
  score: number;
  total: number;
}

/** Documents that go from someone to someone; an order or a protocol has no addressee in the text. */
const NEEDS_ADDRESSEE: DocumentTypeId[] = ['memo', 'report', 'letter', 'explanatory-note', 'statement'];

const NOT_LETTER = '(?<![\\p{L}\\p{N}])';
const NOT_LETTER_AFTER = '(?![\\p{L}\\p{N}])';

const ESSENCE = /(?<![\p{L}])(прош|просим|сообща|доклад|направля|приказыва|информиру|предлага|уведомля|поясня|ходатайству|необходимо|требуется|утверд|назнач|решили|постановили|комиссия)/iu;
const ADDRESSEE = /(?<![\p{L}])(директору|начальнику|руководителю|заместителю|председателю|главному|заведующему|генеральному|ректору|декану|менеджеру|инспектору|в отдел|в управление|в адрес|уважаем\p{L}*)/iu;
const INITIALS = /\p{Lu}?\p{L}+\s+\p{L}\.\s?\p{L}\./gu;
const AUTHOR = /(?<![\p{L}])(от\s+\p{L}+\s+\p{L}\.\s?\p{L}\.|я,\s+\p{L}+)/iu;
const FACTS = /\d|(?<![\p{L}])(январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр|рубл|тысяч|миллион)/iu;
const MIN_LENGTH = 80;

/** Local check of what the AI will need; it runs on every keystroke and sends nothing. */
export function analyzeDraft(text: string, documentType: DocumentTypeId): ReadinessReport {
  const draft = text.trim();
  const initials = draft.match(INITIALS)?.length ?? 0;
  const styleIssues = findStyleIssues(draft);

  const checks: ReadinessCheck[] = [
    {
      id: 'essence', label: 'Суть или просьба', ok: ESSENCE.test(draft),
      hint: 'Сформулируйте, что нужно: «прошу…», «сообщаю…», «докладываю…»',
    },
    ...(NEEDS_ADDRESSEE.includes(documentType) ? [{
      id: 'addressee' as const, label: 'Адресат', ok: ADDRESSEE.test(draft),
      hint: 'Кому документ: должность и ФИО, например «директору Иванову И. И.»',
    }] : []),
    {
      id: 'author', label: 'Автор', ok: AUTHOR.test(draft) || initials >= 2,
      hint: 'От кого: «от Петрова П. П., ведущего инженера»',
    },
    {
      id: 'facts', label: 'Конкретика', ok: FACTS.test(draft),
      hint: 'Добавьте цифры, даты, суммы или сроки — по ним решение принимают быстрее',
    },
    {
      id: 'length', label: 'Объём', ok: draft.length >= MIN_LENGTH,
      hint: `Хотя бы пара предложений — сейчас ${draft.length} из ${MIN_LENGTH} символов`,
    },
    {
      id: 'tone', label: 'Деловой тон', ok: styleIssues.length === 0,
      hint: 'Есть разговорные слова — замените их ниже',
    },
  ];
  return { checks, score: checks.filter((check) => check.ok).length, total: checks.length };
}

// ── Business style ──────────────────────────────────────────────────────────

export interface StyleIssue {
  word: string;
  /** Empty string: the word is a filler and is removed. */
  replacement: string;
  index: number;
}

/** Colloquial word → neutral business wording. Longer phrases go first so they win over their parts. */
const STYLE_DICTIONARY: Array<[string, string]> = [
  ['как бы', ''], ['в общем', ''], ['на самом деле', ''], ['спасибо заранее', ''],
  ['привет', ''], ['приветик', ''], ['короче', ''], ['типа', ''], ['блин', ''], ['капец', ''], ['пожалуйста-пожалуйста', 'пожалуйста'],
  ['надо', 'необходимо'], ['щас', 'сейчас'], ['чё', 'что'], ['че', 'что'], ['норм', 'нормально'], ['ок', 'хорошо'], ['окей', 'хорошо'],
  ['плиз', 'пожалуйста'], ['плз', 'пожалуйста'], ['спс', 'спасибо'],
  ['комп', 'компьютер'], ['компы', 'компьютеры'], ['ноут', 'ноутбук'], ['ноуты', 'ноутбуки'], ['инет', 'интернет'], ['принтак', 'принтер'],
  ['админ', 'системный администратор'], ['шеф', 'руководитель'], ['начальство', 'руководство'],
  ['зп', 'заработная плата'], ['зарплата', 'заработная плата'], ['бабки', 'денежные средства'],
  ['сломался', 'вышел из строя'], ['сломалась', 'вышла из строя'], ['сломалось', 'вышло из строя'], ['сломались', 'вышли из строя'],
  ['глючит', 'работает со сбоями'], ['тормозит', 'работает медленно'], ['срочняк', 'в срочном порядке'], ['косяк', 'недочёт'],
];

const STYLE_PATTERN = new RegExp(
  `${NOT_LETTER}(${STYLE_DICTIONARY.map(([word]) => word.replace(/\s/g, '\\s+')).join('|')})${NOT_LETTER_AFTER}`,
  'giu',
);

export function findStyleIssues(text: string): StyleIssue[] {
  const issues: StyleIssue[] = [];
  for (const match of text.matchAll(STYLE_PATTERN)) {
    const normalized = match[0].toLowerCase().replace(/\s+/g, ' ');
    const entry = STYLE_DICTIONARY.find(([word]) => word === normalized);
    if (entry) issues.push({ word: match[0], replacement: entry[1], index: match.index ?? 0 });
  }
  return issues;
}

const isSentenceStart = (text: string, index: number) => /(^|[.!?…]\s*|\n\s*)$/.test(text.slice(0, index));
const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

/** Apply one fix. A filler is removed with the comma and spaces after it; a capital letter is kept. */
export function applyStyleFix(text: string, issue: StyleIssue): string {
  let index = issue.index;
  if (text.slice(index, index + issue.word.length) !== issue.word) {
    index = text.indexOf(issue.word);
    if (index < 0) return text;
  }
  const before = text.slice(0, index);
  const after = text.slice(index + issue.word.length);
  const startsSentence = isSentenceStart(text, index);

  if (!issue.replacement) {
    const rest = after.replace(/^[,;:!]?[ \t]*/, '');
    const head = before.replace(/[ \t]+$/, '');
    const glue = head && rest && !/\s$/.test(head) ? ' ' : '';
    return head + glue + (startsSentence ? capitalize(rest) : rest);
  }
  const upper = issue.word.charAt(0) === issue.word.charAt(0).toUpperCase() && issue.word.charAt(0) !== issue.word.charAt(0).toLowerCase();
  return before + (upper ? capitalize(issue.replacement) : issue.replacement) + after;
}

/** Apply every fix from the end of the text, so earlier positions stay valid. */
export function applyAllStyleFixes(text: string): string {
  return findStyleIssues(text).reverse().reduce((current, issue) => applyStyleFix(current, issue), text);
}

// ── Export ──────────────────────────────────────────────────────────────────

/** Plain text for an e-mail: subject and addressee, paragraphs, then the signature. */
export function buildEmailText(correctedText: string, requisites: Requisites): string {
  const value = (key: string) => requisites[key]?.trim() ?? '';
  const header = [
    value('Тема') && `Тема: ${value('Тема')}`,
    (value('Адресат') || value('Лицо адресата')) && `Кому: ${value('Адресат') || value('Лицо адресата')}`,
  ].filter(Boolean);
  const paragraphs = correctedText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const signature = [
    value('Должность автора') || value('Должность подписывающего'),
    value('ФИО автора') || value('ФИО подписывающего'),
  ].filter(Boolean);

  return [header.join('\n'), paragraphs.join('\n\n'), signature.join('\n')].filter(Boolean).join('\n\n');
}

// ── Autosave ────────────────────────────────────────────────────────────────

export interface SavedDraft {
  text: string;
  documentType: DocumentTypeId;
  templateId: string;
  savedAt: string;
}

const DRAFT_KEY = 'docxgen-draft';

export function saveDraft(draft: Omit<SavedDraft, 'savedAt'>, now = new Date()) {
  try {
    if (!draft.text.trim()) localStorage.removeItem(DRAFT_KEY);
    else localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, savedAt: now.toISOString() }));
  } catch { /* storage is blocked (private mode) — the editor works without autosave */ }
}

export function loadSavedDraft(): SavedDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as SavedDraft;
    return typeof draft?.text === 'string' && draft.text.trim() ? draft : null;
  } catch {
    return null;
  }
}

export function clearSavedDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
}

// ── Hotkeys ─────────────────────────────────────────────────────────────────

export type HotkeyAction = 'primary' | 'download';

/** Ctrl/⌘+Enter runs the main button, Ctrl/⌘+S downloads the DOCX (any keyboard layout). */
export function matchHotkey(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'> & { code?: string }): HotkeyAction | null {
  if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return null;
  if (event.key === 'Enter') return 'primary';
  if (event.code === 'KeyS' || ['s', 'S', 'ы', 'Ы'].includes(event.key)) return 'download';
  return null;
}
