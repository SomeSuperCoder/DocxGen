/**
 * Keyboard builders for the dialog engine.
 *
 * Each builder returns Button[][] — an array of rows, each row an array of buttons.
 * Buttons carry encoded payloads (max 64 chars) that the adapter renders as
 * platform-specific inline keyboards. The stateVersion 'r' field is injected
 * so the dispatcher can reject stale button presses.
 *
 * Why keyboards are separate from texts: texts.js owns user-facing copy;
 * keyboards.js owns actionable button structures with encoded payloads.
 * This separation keeps copy changes (texts) independent from behavior changes (buttons).
 */

import { encode } from './payload.js';

/**
 * Main menu keyboard — shown in idle state.
 * @param {number} stateVersion
 * @returns {import('./flow.js').Button[][]}
 */
export function mainKeyboard(stateVersion = 0) {
  return [
    [{ label: 'Создать документ', action: encode({ a: 'new', r: stateVersion }) }],
    [{ label: 'Мои документы', action: encode({ a: 'documents', r: stateVersion }) }],
  ];
}

/** Кнопка запуска мини-приложения MAX. Для незарегистрированного локального URL используется ссылка. */
export function miniAppKeyboard({ url, botUsername } = {}) {
  if (!url) return undefined;
  return [[{
    label: '🚀 Открыть мини‑приложение',
    ...(botUsername ? { type: 'open_app', webApp: botUsername } : { type: 'link', url }),
  }]];
}

/**
 * Draft collection keyboard — shown once the draft has text (never under an empty draft).
 * @param {number} stateVersion
 * @returns {import('./flow.js').Button[][]}
 */
export function draftKeyboard(stateVersion = 0) {
  return [
    [{ label: 'Готово — выбрать тип', style: 'primary', action: encode({ a: 'continue', r: stateVersion }) }],
    [
      { label: 'Показать черновик', action: encode({ a: 'show_draft', r: stateVersion }) },
      { label: 'Заменить текст', action: encode({ a: 'replace_mode', r: stateVersion }) },
    ],
  ];
}

/** «Назад» — to the previous step; the flow handles `back` at the type and the template steps. */
function backRow(stateVersion) {
  return [{ label: '← Назад', action: encode({ a: 'back', r: stateVersion }) }];
}

/**
 * Document type keyboard — one button per type, then «Назад» to the draft.
 * @param {Array<{ id: string, name: string }>} docTypes
 * @param {number} stateVersion
 * @returns {import('./flow.js').Button[][]}
 */
export function typeKeyboard(docTypes, stateVersion = 0) {
  return [
    ...docTypes.map(dt => [
      { label: dt.name, action: encode({ a: 'set_type', v: dt.id, r: stateVersion }) },
    ]),
    backRow(stateVersion),
  ];
}

/**
 * Template keyboard — one button per template, then «Назад» to the type.
 * The label is the name only: the description is in the message, and VK cuts a label at 40 characters.
 * @param {Array<{ id: string, name: string, description: string }>} templates
 * @param {number} stateVersion
 * @returns {import('./flow.js').Button[][]}
 */
export function templateKeyboard(templates, stateVersion = 0) {
  return [
    ...templates.map(t => [
      { label: t.name, action: encode({ a: 'set_template', v: t.id, r: stateVersion }) },
    ]),
    backRow(stateVersion),
  ];
}

/**
 * Field answer keyboard — shown when asking for a missing required field.
 * @param {number} stateVersion
 * @returns {import('./flow.js').Button[][]}
 */
export function fieldKeyboard(stateVersion = 0) {
  return [
    [{ label: 'Пропустить', action: encode({ a: 'skip_field', r: stateVersion }) }],
    [{ label: 'Пропустить все вопросы', action: encode({ a: 'skip_all', r: stateVersion }) }],
  ];
}

/**
 * Post-processing keyboard — shown after document is ready.
 * @param {number} stateVersion
 * @returns {import('./flow.js').Button[][]}
 */
export function resultKeyboard(stateVersion = 0) {
  return [
    [
      { label: 'Другой шаблон', action: encode({ a: 'other_template', r: stateVersion }) },
      { label: 'Другой тип', action: encode({ a: 'other_type', r: stateVersion }) },
    ],
    [
      { label: 'Показать текст', action: encode({ a: 'show_draft', r: stateVersion }) },
      { label: 'Изменить текст', action: encode({ a: 'edit_text', r: stateVersion }) },
    ],
    [{ label: 'Новый документ', action: encode({ a: 'new', r: stateVersion }) }],
  ];
}

/**
 * Retry keyboard — shown on AI failure.
 * @param {number} stateVersion
 * @returns {import('./flow.js').Button[][]}
 */
export function retryKeyboard(stateVersion = 0) {
  return [
    [{ label: 'Повторить', action: encode({ a: 'retry', r: stateVersion }) }],
    [
      { label: 'Показать черновик', action: encode({ a: 'show_draft', r: stateVersion }) },
      { label: 'Новый документ', action: encode({ a: 'new', r: stateVersion }) },
    ],
  ];
}

/**
 * Warning confirmation keyboard — shown when AI added facts.
 * @param {number} stateVersion
 * @returns {import('./flow.js').Button[][]}
 */
export function warningKeyboard(stateVersion = 0) {
  return [
    [{ label: 'Всё верно', action: encode({ a: 'deliver', r: stateVersion }) }],
    [{ label: 'Повторить обработку', action: encode({ a: 'retry', r: stateVersion }) }],
    [{ label: 'Изменить текст', action: encode({ a: 'edit_text', r: stateVersion }) }],
  ];
}

/**
 * Resend keyboard — shown on delivery failure.
 * @param {number} stateVersion
 * @returns {import('./flow.js').Button[][]}
 */
export function resendKeyboard(stateVersion = 0) {
  return [
    [{ label: 'Отправить ещё раз', action: encode({ a: 'resend', r: stateVersion }) }],
  ];
}
