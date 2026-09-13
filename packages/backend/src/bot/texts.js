/**
 * Bot text templates — all user-facing strings for the dialog engine.
 *
 * Every function returns an HTML string (or a structured object for messages
 * that include buttons). Russian language only.
 *
 * Markup: only <b> and <i> — MAX renders them (format: 'html'),
 * VK strips them in adapters/common/markup.js.
 * Everything that comes from the user, the AI or the catalog goes through esc(),
 * otherwise a "<" in a draft would break the message.
 *
 * Import and call the function at reply time — never pre-compute.
 */

/**
 * Escape a value for insertion into an HTML message (text only — values never go into attributes).
 * @param {unknown} value
 * @returns {string}
 */
export function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/** «1 символ», «2 символа», «5 символов». */
function chars(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  const word = mod10 === 1 && mod100 !== 11 ? 'символ'
    : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'символа'
      : 'символов';
  return `${count} ${word}`;
}

// ── Greeting ─────────────────────────────────────────────────────────────────

/**
 * How a draft can be sent. Voice messages are mentioned only where the platform delivers them
 * to the bot: the MAX Bot API sends a voice message without its content (see adapters/max/normalize.js).
 * @typedef {{ voice?: boolean }} InputOptions
 */

/** «текстом или голосовым» / «текстом». */
function byText({ voice = true } = {}, withVoice = 'текстом или голосовым') {
  return voice ? withVoice : 'текстом';
}

/**
 * Welcome message shown on /start or first interaction.
 * The draft is sent right away — there is no separate «create a document» step.
 * @param {{ firstName?: string, lastName?: string } | null} profile
 * @param {InputOptions} [options]
 * @returns {{ text: string }}
 */
export function greeting(profile = null, options = {}) {
  const name = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ');
  return {
    text: [
      name ? `👋 <b>Здравствуйте, ${esc(name)}!</b>` : '👋 <b>Здравствуйте!</b>',
      'Я оформлю служебный документ по вашему черновику — <b>за 3 шага</b>:',
      '',
      '1️⃣ вы присылаете черновик — как есть, хоть обрывками',
      '2️⃣ выбираете тип документа и оформление',
      '3️⃣ получаете готовый файл Word',
      '',
      '<i>Исправлю ошибки и стиль, но не добавлю сведений, которых нет в тексте.</i>',
      '',
      `👇 <b>Пришлите черновик</b> следующим сообщением — ${byText(options)}.`,
    ].join('\n'),
  };
}

/**
 * Hint for the idle state when the user sends something that is not a draft.
 * @param {InputOptions} [options]
 * @returns {string}
 */
export function pressCreate(options = {}) {
  return `👇 Пришлите черновик — ${byText(options)}. Из него я и сделаю документ.`;
}

// ── Draft collection ─────────────────────────────────────────────────────────

/**
 * Step 1 prompt — ask for the draft text. No buttons yet: there is nothing to go on with.
 * @param {InputOptions} [options]
 * @returns {string}
 */
export function collectDraftStart(options = {}) {
  return [
    '📝 <b>Шаг 1 из 3 · Черновик</b>',
    '',
    `Пришлите черновик ${byText(options)} — можно несколькими сообщениями, я соберу их по порядку.`,
    'Когда закончите, нажмите «Готово» под моим ответом.',
  ].join('\n');
}

/**
 * Acknowledge draft received, show character count.
 * @param {number} charCount
 * @param {InputOptions} [options]
 * @returns {{ text: string, buttons: string[][] }}
 */
export function collectDraftAccepted(charCount, options = {}) {
  return {
    text: [
      `✍️ <b>Добавил в черновик</b> — теперь в нём ${chars(charCount)}.`,
      `Это всё? Нажмите «Готово». Или пришлите продолжение — ${byText(options, 'текстом или голосом')}.`,
    ].join('\n'),
    buttons: [
      ['Готово — выбрать тип'],
      ['Показать черновик', 'Заменить текст'],
    ],
  };
}

/**
 * Draft preview (first 2000 characters).
 * @param {string} draft
 * @returns {string}
 */
export function showDraft(draft) {
  const source = String(draft ?? '');
  const shown = source.slice(0, 2000);
  const cut = source.length > shown.length ? '\n\n<i>…показано начало черновика</i>' : '';
  return `📝 <b>Черновик</b> · ${chars(source.length)}\n\n${esc(shown)}${cut}`;
}

/**
 * @param {InputOptions} [options]
 * @returns {string}
 */
export function draftEmpty(options = {}) {
  return `📭 В черновике пока пусто. Пришлите его ${byText(options)} — после этого появится кнопка «Готово».`;
}

/** @returns {string} */
export function audioUnavailable() {
  return '🎙️ Не удалось получить аудиофайл. Отправьте его ещё раз или введите текст.';
}

/** @returns {string} */
export function audioNotRecognized() {
  return '🎙️ <b>Не удалось распознать голосовое сообщение.</b>\nЗапишите его ещё раз — чётче и ближе к микрофону — или пришлите текстом.';
}

/**
 * A voice message outside the draft step. Requisites and the corrected text go into the document
 * as they are, and a transcript has no capitals, punctuation or digits.
 * @param {boolean} expectsText - the step waits for a typed answer (a requisite, the edited text)
 * @returns {string}
 */
export function voiceOnlyForDraft(expectsText) {
  return expectsText
    ? '🎙️ Голосом можно прислать только черновик. Здесь напишите ответ текстом.'
    : '🎙️ Голосом можно прислать только черновик. Сейчас выберите вариант кнопкой.';
}

/**
 * Transcript of a voice message, shown before the regular reply.
 * @param {string} text
 * @returns {string}
 */
export function voiceRecognized(text) {
  const source = String(text ?? '');
  const shown = source.length > 1000 ? `${source.slice(0, 1000)}…` : source;
  return `🎙️ <b>Распознал голосовое:</b>\n<i>${esc(shown)}</i>`;
}

/**
 * @param {InputOptions} [options]
 * @returns {string}
 */
export function replaceMode(options = {}) {
  return `🔄 Пришлите новый черновик ${byText(options)} — он заменит весь прежний текст.`;
}

/** @returns {string} */
export function backToDraft() {
  return '📝 <b>Вернулись к черновику.</b>\nМожно дописать текст или нажать «Готово».';
}

/**
 * @param {InputOptions} [options]
 * @returns {string}
 */
export function newDocument(options = {}) {
  return `🆕 <b>Новый документ.</b>\nПришлите черновик — ${byText(options)}.`;
}

// ── Document type selection ──────────────────────────────────────────────────

/**
 * Show available document types for selection.
 * @param {Array<{ id: string, name: string, hint: string }>} types
 * @returns {{ text: string, buttons: string[][] }}
 */
export function chooseType(types) {
  const lines = ['📄 <b>Шаг 2 из 3 · Тип документа</b>', '', 'Какой документ нужен?', ''];
  const buttons = [];
  for (const t of types) {
    lines.push(`• <b>${esc(t.name)}</b> — ${esc(t.hint)}`);
    buttons.push([t.name]);
  }
  return { text: lines.join('\n'), buttons };
}

/** @returns {string} */
export function unknownType() {
  return '🤔 Не понял тип. Выберите кнопкой.';
}

// ── Template selection ───────────────────────────────────────────────────────

/**
 * Show available templates for selection.
 * @param {Array<{ id: string, name: string, description: string }>} templates
 * @returns {{ text: string, buttons: string[][] }}
 */
export function chooseTemplate(templates) {
  const lines = [
    '🎨 <b>Шаг 2 из 3 · Оформление</b>',
    '',
    'Шаблон меняет только внешний вид — текст остаётся тем же.',
    '',
  ];
  const buttons = [];
  for (const t of templates) {
    lines.push(`• <b>${esc(t.name)}</b> — ${esc(t.description)}`);
    buttons.push([t.name]);
  }
  return { text: lines.join('\n'), buttons };
}

// ── Processing ───────────────────────────────────────────────────────────────

/**
 * "Processing..." message shown while AI is working.
 * @returns {string}
 */
export function processing() {
  return [
    '⏳ <b>Шаг 3 из 3 · Обработка</b>',
    '',
    'Исправляю текст и проверяю реквизиты. Обычно это занимает до минуты.',
    'Если для документа чего-то не хватит — например, адресата, — спрошу.',
  ].join('\n');
}

/** @returns {string} */
export function retrying() {
  return '🔁 <b>Повторная обработка…</b>\nПришлю результат, как только он будет готов.';
}

// ── Result ───────────────────────────────────────────────────────────────────

/**
 * Show AI processing results — what was changed.
 * @param {string[]} changes  list of changes made by AI
 * @returns {string}
 */
export function result(changes) {
  if (!changes || changes.length === 0) {
    return '✅ <b>Текст обработан.</b> Исправлений не потребовалось.';
  }
  const items = changes.map((c) => `• ${esc(c)}`).join('\n');
  return `✅ <b>Текст обработан.</b> Что изменено:\n${items}`;
}

/**
 * Corrected text preview.
 * @param {string} text
 * @returns {string}
 */
export function showResult(text) {
  return `📄 <b>Исправленный текст</b>\n\n${esc(text)}`;
}

/** @returns {string} */
export function editPrompt() {
  return [
    '✏️ <b>Отправьте исправленный текст.</b>',
    'Абзацы разделяйте пустой строкой. Первая строка — заголовок «О ...».',
  ].join('\n');
}

// ── Field prompt ─────────────────────────────────────────────────────────────

/**
 * Ask the user for a missing required field.
 * @param {{ key: string, label: string, question: string, example?: string }} field
 * @param {number} remaining  fields still to ask, including this one
 * @returns {{ text: string, buttons: string[][] }}
 */
export function askField(field, remaining = 1) {
  const lines = [
    `🧾 <b>Не хватает для документа: ${esc(field.label)}</b>${remaining > 1 ? ` · осталось ${remaining}` : ''}`,
    '',
    esc(field.question),
  ];
  if (field.example) {
    lines.push(`<i>Например: ${esc(field.example)}</i>`);
  }
  lines.push('', `Ответьте сообщением или нажмите «Пропустить» — тогда в документе останется пометка [${esc(field.label)}].`);

  return {
    text: lines.join('\n'),
    buttons: [
      ['Пропустить'],
      ['Пропустить все вопросы'],
    ],
  };
}

// ── Document ready ───────────────────────────────────────────────────────────

/**
 * Final message — document is ready.
 * @param {string} typeName
 * @param {string} templateName
 * @param {string[]} placeholders  labels of unfilled fields (may be empty)
 * @param {{ requestedId: string, reason: string } | null} fallback  if fallback template was used
 * @returns {string}
 */
export function ready(typeName, templateName, placeholders = [], fallback = null) {
  const lines = [
    '🎉 <b>Документ готов!</b>',
    `${esc(typeName)} · шаблон «${esc(templateName)}»`,
  ];

  if (placeholders.length > 0 || fallback) lines.push('');
  if (placeholders.length > 0) {
    lines.push(`🟨 Незаполненные реквизиты выделены жёлтым: ${placeholders.map(esc).join(', ')}.`);
  }
  if (fallback) {
    lines.push(`⚠️ Шаблон «${esc(fallback.requestedId)}» недоступен, использован стандартный.`);
  }

  lines.push('', '<i>Файл — в следующем сообщении. Шаблон или тип можно сменить одной кнопкой.</i>');
  return lines.join('\n');
}

/** @returns {string} */
export function resending() {
  return '📎 Отправляю файл ещё раз.';
}

// ── Error messages ───────────────────────────────────────────────────────────

/**
 * AI unavailable error message.
 * @param {number} charCount  draft character count (reassurance that data is safe)
 * @returns {{ text: string, buttons: string[][] }}
 */
export function aiError(charCount = 0) {
  const lines = [
    '⚠️ <b>Не удалось обработать текст</b>',
    'Сервис ИИ сейчас недоступен.',
  ];
  if (charCount > 0) {
    lines.push('', `💾 Ваш черновик сохранён (${chars(charCount)}) — ничего вводить заново не нужно.`);
  }
  return {
    text: lines.join('\n'),
    buttons: [
      ['Повторить'],
      ['Показать черновик', 'Новый документ'],
    ],
  };
}

/**
 * Delivery error — file ready but send failed.
 * @returns {{ text: string, buttons: string[][] }}
 */
export function deliveryError() {
  return {
    text: [
      '📎 <b>Файл готов, но отправить его не удалось.</b>',
      'Нажмите «Отправить ещё раз» — документ не будет обрабатываться заново.',
    ].join('\n'),
    buttons: [['Отправить ещё раз']],
  };
}

/**
 * Stale button pressed — the state has moved on.
 * @returns {string}
 */
export function staleButton() {
  return '↩️ Эта кнопка относится к предыдущему шагу.';
}

/** @returns {string} */
export function unknownState() {
  return 'Неизвестное состояние. Начните заново.';
}

/** @returns {string} */
export function commandDisabled() {
  return 'Эта команда отключена.';
}

/**
 * Help message — how the bot works and which commands exist.
 * @param {InputOptions} [options]
 * @returns {string}
 */
export function help(options = {}) {
  const voice = options.voice ?? true;
  return [
    '💡 <b>Как это работает</b>',
    '',
    `1️⃣ пришлите черновик ${byText(options)} — можно несколькими сообщениями — и нажмите «Готово»;`,
    '2️⃣ выберите тип документа и шаблон оформления;',
    '3️⃣ ответьте на вопросы о недостающих данных — или пропустите их;',
    '4️⃣ получите файл Word; шаблон и тип можно сменить одной кнопкой.',
    '',
    voice
      ? '🎙️ Голосовые распознаю и покажу, что понял, — текст потом исправит ИИ.'
      : '🎙️ Голосовые сообщения MAX пока не передаёт ботам. Надиктовать черновик можно на сайте или в боте ВКонтакте.',
    '',
    '<b>Команды</b>',
    '/start — начать заново',
    '/new — новый документ',
    '/help — эта справка',
  ].join('\n');
}

/**
 * Confirmation that the simulated AI outage is armed (/ai_fail, scenario 6).
 * @returns {string}
 */
export function aiFaultArmed() {
  return '🧪 <b>Режим проверки:</b> следующая обработка завершится имитацией сбоя ИИ.';
}

/**
 * Generic "busy" message — user sends text while processing.
 * @returns {string}
 */
export function busy() {
  return '⏳ Обработка ещё идёт — пришлю результат, как только он будет готов.';
}

/**
 * Fact warnings from AI processing.
 * @param {{ added?: string[], lost?: string[] }} warnings
 * @returns {string}
 */
export function factWarnings(warnings) {
  const lines = ['⚠️ <b>Проверьте результат</b>'];
  if (warnings.added?.length) {
    lines.push(
      `• В исправленном тексте есть сведения, которых нет в черновике: ${warnings.added.map(esc).join(', ')}.`,
    );
  }
  if (warnings.lost?.length) {
    lines.push(
      `• Не найдены сведения из черновика: ${warnings.lost.map(esc).join(', ')}.`,
    );
  }
  return lines.join('\n');
}
