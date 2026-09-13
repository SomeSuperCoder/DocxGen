/**
 * Product extensions that sit beside the document pipeline.  They are kept
 * deterministic so the web client and bots can use the same behaviour and so
 * a reviewer can verify the result without an AI provider.
 */

const TYPE_RULES = [
  { id: 'report', words: ['докладная', 'докладываю', 'нарушен', 'прошу принять меры', 'руководителю'] },
  { id: 'reference', words: ['справка', 'сообщаем', 'информируем', 'по состоянию', 'сведения'] },
  { id: 'letter', words: ['уважаемый', 'уважаемая', 'письмо', 'обращаемся', 'просим вас', 'адрес:'] },
  { id: 'memo', words: ['служебная', 'служебную', 'внутренняя записка', 'прошу согласовать', 'необходимо'] },
  { id: 'explanatory-note', words: ['объяснительная', 'пояснительная', 'объясняю', 'поясняю'] },
];

export function detectDocumentType(draft, catalog = []) {
  const text = String(draft ?? '').toLocaleLowerCase('ru-RU');
  const ranked = TYPE_RULES.map((rule) => {
    const matches = rule.words.filter((word) => text.includes(word));
    return { id: rule.id, score: matches.length, matches };
  }).sort((a, b) => b.score - a.score);
  const top = ranked[0];
  const type = catalog.find((item) => item.id === top?.id);
  const fallback = catalog[0];
  const selected = type || fallback || { id: top?.id || 'memo', name: top?.id || 'Служебная записка' };
  const confidence = top?.score ? Math.min(0.99, 0.58 + top.score * 0.14) : 0.35;
  return {
    typeId: selected.id,
    typeName: selected.name,
    confidence: Number(confidence.toFixed(2)),
    evidence: top?.matches || [],
    alternatives: ranked.slice(1, 3).map((item) => ({
      typeId: item.id,
      typeName: catalog.find((entry) => entry.id === item.id)?.name || item.id,
      score: item.score,
    })),
  };
}

const MONTHS = {
  января: '01', февраля: '02', марта: '03', апреля: '04', мая: '05', июня: '06',
  июля: '07', августа: '08', сентября: '09', октября: '10', ноября: '11', декабря: '12',
};
const NUMBER_WORDS = {
  ноль: 0, один: 1, одна: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5,
  шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10, одиннадцать: 11,
  двенадцать: 12, тринадцать: 13, четырнадцать: 14, пятнадцать: 15,
  шестнадцать: 16, семнадцать: 17, восемнадцать: 18, девятнадцать: 19,
  двадцать: 20, тридцать: 30, сорок: 40, пятьдесят: 50, шестьдесят: 60,
  семьдесят: 70, восемьдесят: 80, девяносто: 90,
  сто: 100, двести: 200, триста: 300, четыреста: 400, пятьсот: 500,
  шестьсот: 600, семьсот: 700, восемьсот: 800, девятьсот: 900,
};
const ORDINALS = {
  первое: 1, второе: 2, третье: 3, четвертое: 4, пятое: 5, шестое: 6, седьмое: 7,
  восьмое: 8, девятое: 9, десятое: 10, одиннадцатое: 11, двенадцатое: 12,
  тринадцатое: 13, четырнадцатое: 14, пятнадцатое: 15, шестнадцатое: 16,
  семнадцатое: 17, восемнадцатое: 18, девятнадцатое: 19, двадцатое: 20,
  двадцатьпервое: 21, двадцатьвторое: 22, двадцатьтретье: 23, двадцатьчетвертое: 24,
  двадцатьпятое: 25, двадцатьшестое: 26, двадцатьседьмое: 27, двадцатьвосьмое: 28,
  двадцатьдевятое: 29, тридцатое: 30, тридцатьпервое: 31,
  первого: 1, второго: 2, третьего: 3, четвертого: 4, пятого: 5, шестого: 6, седьмого: 7,
  восьмого: 8, девятого: 9, десятого: 10, двадцатьшестого: 26,
};

function numberFromWords(value) {
  const parts = String(value).toLocaleLowerCase('ru-RU').split(/[-\s]+/).filter(Boolean);
  if (parts.length === 1 && ORDINALS[parts[0]] !== undefined) return ORDINALS[parts[0]];
  const compactOrdinal = parts.join('');
  if (ORDINALS[compactOrdinal] !== undefined) return ORDINALS[compactOrdinal];
  if (!parts.length) return null;
  let total = 0; let current = 0;
  for (const part of parts) {
    if (part.startsWith('тысяч')) { total += (current || 1) * 1000; current = 0; continue; }
    if (part.startsWith('миллион')) { total += (current || 1) * 1_000_000; current = 0; continue; }
    if (NUMBER_WORDS[part] === undefined) return null;
    current += NUMBER_WORDS[part];
  }
  return total + current;
}

function yearFromWords(value) {
  const source = String(value ?? '').toLocaleLowerCase('ru-RU').replace(/\s+г(?:ода)?\.?$/, '').trim();
  if (/^\d{4}$/.test(source)) return Number(source);
  const thousand = source.match(/^([а-яё -]+?)\s+тысяч(?:и|а|у|е|ой)?\s+(.+)$/);
  if (thousand) {
    const head = numberFromWords(thousand[1]);
    const tail = numberFromWords(thousand[2]);
    if (head !== null && tail !== null) return head * 1000 + tail;
  }
  return numberFromWords(source);
}

export function normalizeRussianDate(value) {
  const source = String(value ?? '').trim();
  if (!source) return source;
  const numeric = source.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/);
  if (numeric) return `${numeric[1].padStart(2, '0')}.${numeric[2].padStart(2, '0')}.${numeric[3]}`;
  const named = source.match(/^(\d{1,2})\s+([а-яё]+)(?:\s+(\d{4}))?$/i);
  if (named && MONTHS[named[2].toLocaleLowerCase('ru-RU')]) {
    return `${named[1].padStart(2, '0')}.${MONTHS[named[2].toLocaleLowerCase('ru-RU')]}.${named[3] || new Date().getFullYear()}`;
  }
  const words = source.match(/^(.+?)\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?:\s+(.+))?$/i);
  if (words) {
    const day = numberFromWords(words[1]);
    const month = MONTHS[words[2].toLocaleLowerCase('ru-RU')];
    const year = words[3] ? yearFromWords(words[3]) : new Date().getFullYear();
    if (day && month && year) return `${String(day).padStart(2, '0')}.${month}.${year}`;
  }
  return source;
}

export function normalizeRussianRequisite(key, value) {
  const source = String(value ?? '').trim();
  if (!source) return source;
  if (/дат|срок|период/i.test(key)) return normalizeRussianDate(source);
  if (/сумм|стоим|рубл|бюджет/i.test(key)) {
    const n = numberFromWords(source.replace(/\s*(рублей|рубля|рубль|руб\.)?\s*$/i, ''));
    if (n !== null) return `${n.toLocaleString('ru-RU')} руб.`;
  }
  if (/фио|автор|подписывающ/i.test(key)) {
    const parts = source.replace(/\s+/g, ' ').split(' ');
    if (parts.length >= 3 && parts.every((part) => /^[А-ЯЁа-яё-]+$/.test(part))) return `${parts[0][0].toUpperCase()}${parts[0].slice(1)} ${parts[1][0].toUpperCase()}. ${parts[2][0].toUpperCase()}.`;
  }
  return source.replace(/\s+/g, ' ');
}

/** A transparent checklist based on ГОСТ R 7.0.97-2016 essentials. */
export function checkGost({ docType, template, aiFields = {}, userFields = {}, title, body = [] }) {
  const field = (label) => userFields[label] || aiFields[label]?.value || aiFields[label] || '';
  const checks = [
    { id: 'organization', label: 'Наименование организации', ok: Boolean(template?.organization?.name), detail: template?.organization?.name || 'Добавьте организацию в бланк' },
    { id: 'addressee', label: 'Адресат', ok: Boolean(field('Адресат') || field('Лицо адресата') || field('Организация адресата')), detail: 'Адресат должен быть указан явно' },
    { id: 'date', label: 'Дата документа', ok: /^\d{2}\.\d{2}\.\d{4}$/.test(String(field('Дата'))) || Boolean(template?.autoFill?.date), detail: 'Формат даты: ДД.ММ.ГГГГ' },
    { id: 'title', label: 'Заголовок «О …»', ok: /^О\s+\S+/i.test(String(title || '')), detail: 'Заголовок начинается с «О»' },
    { id: 'body', label: 'Текст документа', ok: body.some((paragraph) => String(paragraph).trim()), detail: 'Добавьте хотя бы один абзац' },
    { id: 'signature', label: 'Подпись', ok: Boolean(field('ФИО автора') || field('ФИО подписывающего')), detail: 'Укажите ФИО подписанта' },
  ];
  if (docType === 'letter') checks.push({ id: 'letter-address', label: 'Адрес получателя', ok: Boolean(field('Адрес адресата')), detail: 'Для письма нужен почтовый адрес' });
  return { standard: 'ГОСТ Р 7.0.97-2016', score: checks.filter((item) => item.ok).length, total: checks.length, checks };
}

export function diffText(source, corrected) {
  const before = String(source ?? '').split(/(\s+)/);
  const after = String(corrected ?? '').split(/(\s+)/);
  const out = [];
  let i = 0; let j = 0;
  while (i < before.length || j < after.length) {
    if (before[i] === after[j]) { if (after[j] !== undefined) out.push({ type: 'same', text: after[j] }); i++; j++; continue; }
    if (after[j] !== undefined && !before.slice(i, i + 3).includes(after[j])) { out.push({ type: 'added', text: after[j++] }); continue; }
    if (before[i] !== undefined) { out.push({ type: 'removed', text: before[i++] }); continue; }
  }
  return out;
}

export function directorySearch(query, entries = []) {
  const q = String(query ?? '').trim().toLocaleLowerCase('ru-RU');
  if (!q) return entries.slice(0, 20);
  const haystack = (entry) => `${entry.name} ${entry.position} ${entry.department}`.toLocaleLowerCase('ru-RU');
  return entries.filter((entry) => {
    const text = haystack(entry);
    return text.includes(q) || q.split(/\s+/).filter(Boolean).some((token) => token.length >= 5 && text.includes(token.slice(0, 5)));
  }).slice(0, 20);
}

export const DEFAULT_DIRECTORY = [
  { id: 'ivanov', name: 'Иванов Иван Иванович', position: 'Генеральный директор', department: 'Руководство', email: '' },
  { id: 'petrova', name: 'Петрова Анна Сергеевна', position: 'Начальник отдела', department: 'Экономический отдел', email: '' },
];

export function formatDirectorySuggestion(entry) {
  if (!entry) return null;
  const [surname = '', ...rest] = String(entry.name || '').split(/\s+/);
  const dativeSurname = surname.endsWith('ов') || surname.endsWith('ев') || surname.endsWith('ин') ? `${surname}у` : surname.endsWith('а') ? `${surname.slice(0, -1)}ой` : surname;
  const position = String(entry.position || '').replace(/^Генеральный директор$/i, 'Генеральному директору').replace(/ый$/, 'ому').replace(/ий$/, 'ему').replace(/ая$/, 'ой').replace(/директор$/, 'директору').replace(/начальник$/, 'начальнику');
  const initials = rest.map((part) => part[0] ? `${part[0]}.` : '').join(' ');
  return [position, dativeSurname, initials].filter(Boolean).join(' ');
}
