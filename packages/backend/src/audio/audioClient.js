import { DomainError } from '../core/errors.js';

/**
 * HTTP-клиент аудиосервиса (Vosk на AUDIO_SERVICE_PORT). Им пользуются и сайт — через маршрут
 * backend, и боты: модель загружена в одном процессе, файл уходит одним и тем же запросом.
 *
 * @param {{ serviceUrl: string, apiKey?: string, fetchImpl?: typeof fetch, timeoutMs?: number }} options
 */
export function createAudioClient({ serviceUrl, apiKey = '', fetchImpl = fetch, timeoutMs = 120000 }) {
  return {
    /**
     * @param {Buffer} buffer - аудиофайл в любом формате, который читает ffmpeg
     * @param {{ platform: string, ownerId: string }} owner
     * @returns {Promise<{ text: string, duration?: number }>}
     */
    async transcribe(buffer, { platform, ownerId }) {
      const form = new FormData();
      form.append('file', new Blob([buffer]), 'audio');
      let response;
      try {
        response = await fetchImpl(`${serviceUrl}/api/audio/transcribe`, {
          method: 'POST',
          headers: { 'X-Owner-Platform': platform, 'X-Owner-Id': String(ownerId), ...(apiKey ? { 'X-Api-Key': apiKey } : {}) },
          body: form,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        const unavailable = new DomainError('STT_UNAVAILABLE', 'Сервис распознавания речи недоступен. Попробуйте позже.', 503);
        unavailable.detail = `${serviceUrl}: ${error.cause?.message ?? error.message}`;
        throw unavailable;
      }

      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new DomainError(body.error?.code ?? 'STT_FAILED', body.error?.message ?? `Аудиосервис ответил HTTP ${response.status}`, response.status);
      }
      return { text: String(body.text ?? '').trim(), duration: body.duration };
    },
  };
}
