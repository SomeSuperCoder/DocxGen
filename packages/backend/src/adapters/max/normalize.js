import { decode } from '../../bot/payload.js';

const command = (text) => { const value = String(text ?? '').trim().toLowerCase(); return ['/start', 'начать'].includes(value) ? 'start' : ['/help', 'помощь'].includes(value) ? 'help' : ['/new', 'новый документ'].includes(value) ? 'new' : value === '/ai_fail' ? 'ai_fail' : null; };
function updates(raw) { return Array.isArray(raw) ? raw : Array.isArray(raw?.updates) ? raw.updates : [raw]; }

const AUDIO_FILE = /\.(m4a|mp3|ogg|oga|opus|wav|webm|aac|amr|flac)$/i;

/** Голосовые MAX ботам не передаёт, поэтому запись можно прислать аудиофайлом — вложение `file` с расширением звука. */
function isAudioAttachment(item) {
  return item?.type === 'audio' || item?.type === 'voice' || (item?.type === 'file' && AUDIO_FILE.test(String(item.filename ?? '')));
}

/** Имя пользователя из объекта User MAX (first_name, last_name; у старых клиентов — только name). */
function profileOf(user) {
  if (!user || user.is_bot) return undefined;
  const firstName = user.first_name ?? String(user.name ?? '').split(/\s+/)[0];
  return firstName ? { firstName, lastName: user.last_name ?? null } : undefined;
}

/** Update MAX → InboundEvent[]: групповые чаты, сообщения ботов и неизвестные типы событий отбрасываются. */
export function toInboundEvents(raw) {
  const result = [];
  for (const update of updates(raw)) {
    if (!update) continue;
    if (update.update_type === 'bot_started') {
      const chatId = update.chat_id ?? update.chat?.chat_id; const userId = update.user?.user_id ?? update.user_id;
      if (chatId !== undefined) result.push({ platform: 'max', kind: 'command', command: 'start', eventId: `bs:${chatId}:${update.timestamp ?? Date.now()}`, peerId: String(chatId), userId: String(userId ?? chatId), profile: profileOf(update.user), meta: {} });
      continue;
    }
    if (update.update_type === 'message_callback') {
      const callback = update.callback ?? {}; const message = callback.message ?? update.message ?? {}; const body = message.body ?? message; const recipient = message.recipient ?? update.recipient ?? {};
      const decoded = decode(callback.payload);
      if (!decoded || (recipient.chat_type && recipient.chat_type !== 'dialog')) continue;
      result.push({ platform: 'max', kind: 'action', action: decoded, callbackId: callback.callback_id, eventId: `cb:${callback.callback_id}`, peerId: String(recipient.chat_id), userId: String(callback.user?.user_id ?? message.sender?.user_id), profile: profileOf(callback.user), meta: { mid: body.mid, text: body.text ?? '', attachments: body.attachments ?? message.attachments ?? [] } });
      continue;
    }
    if (update.update_type !== 'message_created') continue;
    const message = update.message ?? update; const body = message.body ?? message; const recipient = message.recipient ?? update.recipient ?? {}; const sender = message.sender ?? update.sender ?? {};
    if ((recipient.chat_type && recipient.chat_type !== 'dialog') || sender.is_bot) continue;
    // Голосовое сообщение Bot API MAX присылает без поля message: нет ни чата, ни отправителя, ответить некому.
    // Без этой проверки такие события всех пользователей сливались в один диалог «max:undefined».
    if (recipient.chat_id === undefined || recipient.chat_id === null) continue;
     const text = body.text ?? ''; const eventId = `m:${body.mid ?? message.mid ?? `${recipient.chat_id}:${message.timestamp ?? update.timestamp ?? Date.now()}`}`; const cmd = command(text); const audio = (body.attachments ?? []).find(isAudioAttachment);
     result.push({ platform: 'max', kind: audio ? 'audio' : cmd ? 'command' : 'text', ...(audio ? { audio } : cmd ? { command: cmd } : { text }), eventId, peerId: String(recipient.chat_id), userId: String(sender.user_id ?? message.user_id ?? recipient.chat_id), profile: profileOf(sender), meta: { mid: body.mid, chatType: recipient.chat_type } });
  }
  return result;
}
