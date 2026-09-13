import fs from 'node:fs/promises';
import { createPeerQueue } from '../common/peerQueue.js';
import { createBotImages } from '../common/botImages.js';
import { deliverFile } from '../../core/deliveries.js';
import { keyboardAttachment, toMessageBodies } from './render.js';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
/** Файл и видео отдают token напрямую; картинка — в photos, объекте по id снимка: { photos: { "<id>": { token } } }. */
const tokenFromUpload = ({ slot, uploaded }) => uploaded?.token ?? slot?.token ?? Object.values(uploaded?.photos ?? {})[0]?.token ?? null;
const retry = async (task, shouldRetry, delays = [1000, 2000, 4000]) => { for (let i = 0; ; i += 1) try { return await task(); } catch (err) { if (!shouldRetry(err) || i >= delays.length) throw err; await new Promise((resolve) => setTimeout(resolve, delays[i])); } };

export function createMaxAdapter({ db, client, files, log = console, images = createBotImages(), retryDelaysMs } = {}) {
  const queue = createPeerQueue({ intervalMs: 600 });
  /** Иллюстрация сообщения: загружается один раз, токен кешируется в template_assets по ключу «имя@хеш». */
  async function imageAttachment(name) {
    try {
      const asset = await images.load(name); if (!asset) return [];
      const cached = db.prepare('SELECT attachment FROM template_assets WHERE platform=? AND template_id=?').get('max', asset.cacheKey)?.attachment; if (cached) return [{ type: 'image', payload: { token: cached } }];
      const upload = await client.upload('image', asset.buffer, asset.filename, 'image/png');
      const token = tokenFromUpload(upload);
      if (!token) { log.warn?.({ image: name, uploaded: Object.keys(upload?.uploaded ?? {}) }, 'max image upload returned no token'); return []; }
      db.prepare('INSERT OR REPLACE INTO template_assets(platform, template_id, attachment) VALUES (?, ?, ?)').run('max', asset.cacheKey, token);
      return [{ type: 'image', payload: { token } }];
    } catch (err) { log.warn?.({ err, image: name }, 'max image unavailable'); return []; }
  }
  async function sendFile(peerId, reply, event) { const file = files.get(reply.file.fileId); if (!file) throw new Error('Файл не найден'); return deliverFile(db, { platform: 'max', peerId, fileId: file.id, triggerEventId: event.eventId, log, upload: async () => { const result = await client.upload('file', await fs.readFile(file.path), file.filename, DOCX); const token = tokenFromUpload(result); if (!token) throw new Error('MAX не вернул токен файла'); return token; }, send: async (token) => retry(() => client.sendMessage(peerId, { text: reply.file.caption, ...(reply.format ? { format: reply.format } : {}), attachments: [{ type: 'file', payload: { token } }, ...keyboardAttachment(reply.buttons)] }), (err) => err.code === 'attachment.not.ready', retryDelaysMs ?? [1000, 2000, 4000, 8000, 16000]) }); }
  /**
   * Ответ на нажатие: исходное сообщение получает отметку «✓ …» и теряет клавиатуру, чтобы старые кнопки не мешали.
   * Пустой attachments в MAX удаляет все вложения сообщения, поэтому файл или картинку переносим по токену,
   * а если токена нет — сообщение не редактируем и показываем только уведомление (файл остаётся в переписке).
   */
  async function answerCallback(event) {
    const label = event.meta?.label ?? 'Выбрано';
    const kept = (event.meta?.attachments ?? []).filter((attachment) => attachment?.type !== 'inline_keyboard');
    const body = kept.every((attachment) => attachment.payload?.token)
      ? { message: { text: `${event.meta?.text ?? ''}\n\n✓ ${label}`, attachments: kept.map((attachment) => ({ type: attachment.type, payload: { token: attachment.payload.token } })) } }
      : { notification: `✓ ${label}` };
    try { await client.answerCallback(event.callbackId, body); } catch (err) { log.warn?.({ err }, 'max callback answer failed'); }
  }
  return { platform: 'max', async send(peerId, replies, { event } = {}) { if (event?.kind === 'action' && event.callbackId && !event.meta?.answered) { event.meta = { ...event.meta, answered: true }; await answerCallback(event); }
    for (const [replyIndex, reply] of replies.entries()) await queue.enqueue(peerId, async () => { if (reply.file) return sendFile(peerId, reply, event); let bodies = toMessageBodies(reply); if (reply.image) bodies[0].attachments = [...(await imageAttachment(reply.image.name)), ...(bodies[0].attachments ?? [])]; for (const body of bodies) await retry(() => client.sendMessage(peerId, body), (err) => err.status === 429 || err.status >= 500, retryDelaysMs ?? [1000, 2000, 4000]); return replyIndex; }); }, imageAttachment };
}
