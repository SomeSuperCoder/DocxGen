import { DomainError } from '../core/errors.js';
import { createAudioClient } from './audioClient.js';

/**
 * Ссылка на файл голосового сообщения из вложения платформы:
 * MAX — { type: 'audio', payload: { url, token } }, ВК — { type: 'audio_message', audio_message: { link_ogg, link_mp3 } }.
 * @param {object|null} attachment
 * @returns {string|null}
 */
export function audioUrlOf(attachment) {
  return attachment?.payload?.url
    ?? attachment?.audio_message?.link_ogg
    ?? attachment?.audio_message?.link_mp3
    ?? attachment?.url
    ?? null;
}

/** Скачивает файл, не пропуская больше maxBytes (и по заголовку, и по фактическому размеру). */
async function download(url, { maxBytes, fetchImpl }) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw DomainError.AUDIO_INVALID(`Не удалось скачать голосовое сообщение (HTTP ${response.status})`);
  if (Number(response.headers.get('content-length')) > maxBytes) throw DomainError.AUDIO_INVALID('Голосовое сообщение слишком длинное');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > maxBytes) throw DomainError.AUDIO_INVALID('Голосовое сообщение пустое или слишком длинное');
  return buffer;
}

/**
 * Распознавание голосовых сообщений для ботов через аудиосервис (Vosk на AUDIO_SERVICE_PORT).
 * Модель загружена в одном процессе — боты не держат свою копию и шлют файл тем же запросом, что и сайт.
 *
 * @param {{ serviceUrl: string, apiKey?: string, maxBytes?: number, fetchImpl?: typeof fetch }} options
 * @returns {(audio: object, owner: { platform: string, ownerId: string }) => Promise<{ text: string }>}
 */
export function createBotTranscriber({ serviceUrl, apiKey = '', maxBytes = 25 * 1024 * 1024, fetchImpl = fetch }) {
  const client = createAudioClient({ serviceUrl, apiKey, fetchImpl });
  return async function transcribeAudio(audio, owner) {
    let buffer = audio?.buffer;
    if (!buffer) {
      const url = audioUrlOf(audio);
      if (!url) throw DomainError.AUDIO_INVALID('Во вложении нет ссылки на аудиофайл');
      buffer = await download(url, { maxBytes, fetchImpl });
    }
    const { text } = await client.transcribe(buffer, owner);
    return { text };
  };
}
