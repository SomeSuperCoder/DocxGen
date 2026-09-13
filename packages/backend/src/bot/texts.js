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
 * Welcome message shown on /start or first interaction.
 * @returns {{ text: string, buttons: string[][] }}
 */
export function greeting(profile = null) {
  const name = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ');
  return {
    text: [
      name ? `👋 <b>Здравствуйте, ${esc(name)}!</b>` : '👋 <b>Здравствуйте!</b>',
      'Я оформлю служебный документ по вашему черновику — <b>за 3 шага</b>:',
      '',
      '1️⃣ пришлите черновик — как есть, хоть обрывками',
      '2️⃣ выберите тип документа и оформление',
      '3️⃣ получите готовый файл Word',
      '',
      '<i>Исправлю ошибки и стиль, но не добавлю сведений, которых нет в тексте.</i>',
    ].join('\n'),
    buttons: [['Создать документ']],
  };
}

/**
 * Hint for the idle state when the user presses something other than «Создать документ».
 * @returns {string}
 */
export function pressCreate() {
  return 'Нажмите «Создать документ» или просто пришлите текст черновика.';
}

// ── Draft collection ─────────────────────────────────────────────────────────

/**
 * Step 1 prompt — ask for the draft text.
 * @returns {string}
 */
export function collectDraftStart() {
  return [
    '📝 <b>Шаг 1 из 3 · Черновик</b>',
    '',
    'Пришлите текст — можно несколькими сообщениями, я соберу их по порядку.',
    'Когда закончите, нажмите «Продолжить».',
  ].join('\n');
}

/**
 * Acknowledge draft received, show character count.
 * @param {number} charCount
 * @returns {{ text: string, buttons: string[][] }}
 */
export function collectDraftAccepted(charCount) {
  return {
    text: [
      `✍️ <b>Принято.</b> В черновике ${chars(charCount)}.`,
      '<i>Можно дописать ещё или нажать «Продолжить».</i>',
    ].join('\n'),
    buttons: [
      ['Продолжить'],
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

/** @returns {string} */
export function draftEmpty() {
  return '📭 Черновик пуст. Пришлите текст.';
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
 * Transcript of a voice message, shown before the regular reply.
 * @param {string} text
 * @returns {string}
 */
export function voiceRecognized(text) {
  const source = String(text ?? '');
  const shown = source.length > 1000 ? `${source.slice(0, 1000)}…` : source;
  return `🎙️ <b>Распознал голосовое:</b>\n<i>${esc(shown)}</i>`;
}

/** @returns {string} */
export function replaceMode() {
  return '🔄 Отправьте новый текст — старый будет заменён.';
}

/** @returns {string} */
export function backToDraft() {
  return '📝 <b>Вернулись к черновику.</b>\nМожно дописать текст или нажать «Продолжить».';
}

/** @returns {string} */
export function newDocument() {
  return '🆕 <b>Новый документ создан.</b>\nПришлите текст черновика.';
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
    `🧾 <b>Реквизит: ${esc(field.label)}</b>${remaining > 1 ? ` · осталось ${remaining}` : ''}`,
    '',
    esc(field.question),
  ];
  if (field.example) {
    lines.push(`<i>Например: ${esc(field.example)}</i>`);
  }
  lines.push('', `Если оставить пустым, в документе будет пометка [${esc(field.label)}].`);

  return {
    text: lines.join('\n'),
    buttons: [
      ['Оставить незаполненным'],
      ['Пропустить остальные'],
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
 * @returns {string}
 */
export function help() {
  return [
    '💡 <b>Как это работает</b>',
    '',
    '1️⃣ пришлите черновик текстом — можно несколькими сообщениями;',
    '2️⃣ выберите тип документа и шаблон оформления;',
    '3️⃣ ответьте на вопросы о реквизитах — или пропустите их;',
    '4️⃣ получите DOCX и при желании смените шаблон одной кнопкой.',
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
