import fs from 'node:fs/promises';
import { createPeerQueue } from '../common/peerQueue.js';
import { createBotImages } from '../common/botImages.js';
import { deliverFile } from '../../core/deliveries.js';
import { randomIdFor } from './randomId.js';
import { toKeyboard, toSendParams } from './render.js';
import { plainText } from '../common/markup.js';

export function createVkAdapter({ db, client, files, log = console, images = createBotImages(), retryDelaysMs } = {}) {
  const queue = createPeerQueue({ intervalMs: 350 });
  /** Иллюстрация сообщения: загружается один раз, строка вложения кешируется в template_assets по ключу «имя@хеш». */
  async function image(peerId, name) {
    try {
      const asset = await images.load(name); if (!asset) return null;
      const cached = db.prepare('SELECT attachment FROM template_assets WHERE platform=? AND template_id=?').get('vk', asset.cacheKey)?.attachment; if (cached) return cached;
      // Без имени vk-io шлёт PNG как file0.jpg (image/jpeg), и часть серверов загрузки отвечает пустым photo.
      const attachment = await client.uploadPhoto(peerId, asset.buffer, asset.filename);
      db.prepare('INSERT OR REPLACE INTO template_assets(platform, template_id, attachment) VALUES (?, ?, ?)').run('vk', asset.cacheKey, attachment);
      return attachment;
    } catch (err) { log.warn?.({ err, image: name }, 'vk image unavailable'); return null; }
  }
  async function sendFile(peerId, reply, event) { const file = files.get(reply.file.fileId); if (!file) throw new Error('Файл не найден'); return deliverFile(db, { platform: 'vk', peerId, fileId: file.id, triggerEventId: event.eventId, log, upload: async () => client.uploadDoc(peerId, await fs.readFile(file.path), file.filename), send: (attachment, deliveryKey) => sendWithRetry(() => client.sendMessage({ peerId, randomId: randomIdFor(deliveryKey), message: plainText({ text: reply.file.caption, format: reply.format }), attachment, keyboard: toKeyboard(reply.buttons) }), client, retryDelaysMs) }); }
  async function sendWithRetry(task, api, delays = [1000, 2000, 4000]) { for (let i = 0; ; i += 1) try { return await task(); } catch (err) { if (!api.isRetryable?.(err) || i >= delays.length) throw err; await new Promise((resolve) => setTimeout(resolve, delays[i])); } }
  /** ВК не присылает имя в событии сообщения — берём его один раз через users.get (ключ сообщества это позволяет). */
  async function getProfile(userId) {
    const [user] = await client.api.users.get({ user_ids: [Number(userId)] });
    return user?.first_name ? { firstName: user.first_name, lastName: user.last_name ?? null } : null;
  }
  return { platform: 'vk', getProfile, async send(peerId, replies, { event } = {}) { for (const [replyIndex, reply] of replies.entries()) await queue.enqueue(peerId, async () => { if (reply.file) return sendFile(peerId, reply, event); let attachment = reply.image ? (await image(peerId, reply.image.name)) ?? undefined : undefined; for (const [partIndex, params] of toSendParams(reply, { inlineKeyboard: event?.meta?.inlineKeyboard !== false, seed: `${event?.eventId ?? 'system'}:${replyIndex}` }).entries()) await sendWithRetry(() => client.sendMessage({ peerId, ...params, attachment: partIndex === 0 ? attachment : undefined }), client, retryDelaysMs); }); }, image };
}
