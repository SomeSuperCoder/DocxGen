import { DomainError } from '../core/errors.js';

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
  return async function transcribeAudio(audio, { platform, ownerId }) {
    let buffer = audio?.buffer;
    if (!buffer) {
      const url = audioUrlOf(audio);
      if (!url) throw DomainError.AUDIO_INVALID('Во вложении нет ссылки на аудиофайл');
      buffer = await download(url, { maxBytes, fetchImpl });
    }

    const form = new FormData();
    form.append('file', new Blob([buffer]), 'voice.ogg');
    const response = await fetchImpl(`${serviceUrl}/api/audio/transcribe`, {
      method: 'POST',
      headers: { 'X-Owner-Platform': platform, 'X-Owner-Id': String(ownerId), ...(apiKey ? { 'X-Api-Key': apiKey } : {}) },
      body: form,
      signal: AbortSignal.timeout(120000),
    }).catch((error) => { throw DomainError.STT_FAILED(`Аудиосервис недоступен: ${error.message}`); });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new DomainError(body.error?.code ?? 'STT_FAILED', body.error?.message ?? `Аудиосервис ответил HTTP ${response.status}`, response.status);
    }
    return { text: String(body.text ?? '').trim() };
  };
}
