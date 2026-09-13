import { payloadOf } from '../common/buttons.js';
import { splitText } from '../common/splitText.js';
export const MAX_TEXT_LIMIT = 4000;
function renderButton(button) {
  if (button?.type === 'link') return { type: 'link', text: button.label, url: button.url };
  if (button?.type === 'open_app') return { type: 'open_app', text: button.label, web_app: button.webApp || button.web_app, ...(button.payload ? { payload: button.payload } : {}) };
  return { type: 'callback', text: button.label, payload: payloadOf(button) };
}
export function keyboardAttachment(buttons) { return buttons?.length ? [{ type: 'inline_keyboard', payload: { buttons: buttons.map((row) => row.map(renderButton)) } }] : []; }
export function toMessageBodies(reply) { const parts = splitText(reply.text, MAX_TEXT_LIMIT); return parts.map((text, index) => ({ text, ...(['html', 'markdown'].includes(reply.format) ? { format: reply.format } : {}), attachments: index === parts.length - 1 ? keyboardAttachment(reply.buttons) : [] })); }
