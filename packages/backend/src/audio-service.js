import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DomainError } from './core/errors.js';
import { createVoskTranscriber } from './audio/transcriber.js';
import { env } from './config/env.js';
import { log } from './logger.js';

const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function multipartFile(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const type = String(req.headers['content-type'] ?? '');
    const match = type.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    if (!match) return reject(DomainError.AUDIO_INVALID('Ожидается multipart/form-data'));
    const boundary = Buffer.from(`--${match[1] ?? match[2]}`);
    const parts = []; let size = 0;
    req.on('data', (chunk) => { size += chunk.length; if (size > maxBytes + 2 * 1024 * 1024) req.destroy(DomainError.AUDIO_INVALID('Аудиофайл слишком большой')); else parts.push(chunk); });
    req.on('error', reject);
    req.on('end', () => {
      const body = Buffer.concat(parts); const start = body.indexOf(Buffer.from('\r\n\r\n'));
      if (start < 0) return reject(DomainError.AUDIO_INVALID('Поле file не найдено'));
      const header = body.subarray(0, start).toString();
      if (!/name="file"/i.test(header)) return reject(DomainError.AUDIO_INVALID('Поле file не найдено'));
      const end = body.indexOf(boundary, start + 4);
      const file = body.subarray(start + 4, end >= 0 ? end - 2 : body.length);
      if (!file.length || file.length > maxBytes) return reject(DomainError.AUDIO_INVALID('Аудиофайл пустой или слишком большой'));
      resolve(file);
    });
  });
}

export function createAudioServiceApp({ transcriber, maxBytes = env.AUDIO_MAX_BYTES, apiKey = env.API_KEY } = {}) {
  const app = express();
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.post('/api/audio/transcribe', async (req, res, next) => {
    try {
      if (apiKey && req.headers['x-api-key'] !== apiKey) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid API key' } });
      if (!req.headers['x-owner-platform'] || !req.headers['x-owner-id']) throw DomainError.AUDIO_INVALID('Не указаны владелец и платформа');
      const file = await multipartFile(req, maxBytes);
      const result = await transcriber.transcribe(file);
      res.json({ ok: true, text: result.text, duration: result.duration });
    } catch (error) { next(error instanceof DomainError ? error : DomainError.STT_FAILED()); }
  });
  app.use((error, _req, res, _next) => res.status(error.status ?? 500).json({ error: { code: error.code ?? 'STT_FAILED', message: error.message ?? 'Ошибка распознавания' } }));
  return app;
}

// Сравнение полных путей: на Windows argv[1] содержит обратные слэши, и проверка по «/audio-service.js»
// никогда не срабатывала — процесс молча завершался с кодом 0.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let transcriber;
  const configuredModelPath = path.isAbsolute(env.VOSK_MODEL_PATH)
    ? env.VOSK_MODEL_PATH
    : path.resolve(BACKEND_ROOT, env.VOSK_MODEL_PATH);
  const configuredPython = path.isAbsolute(env.VOSK_PYTHON)
    ? env.VOSK_PYTHON
    : path.resolve(BACKEND_ROOT, env.VOSK_PYTHON);
  try {
    transcriber = await createVoskTranscriber({ modelPath: configuredModelPath, ffmpeg: env.FFMPEG_BIN, maxBytes: env.AUDIO_MAX_BYTES, python: configuredPython });
  } catch (error) {
    // Do not terminate the HTTP process. If Vosk/model setup is incomplete,
    // Vite otherwise reports a non-JSON proxy 502 and hides the real cause.
    // Keep the endpoint alive and return a structured STT_FAILED response.
    log.error({ error: error.message }, 'Audio service unavailable');
    transcriber = { transcribe: async () => { throw DomainError.STT_FAILED(`Сервис распознавания не настроен: ${error.message}`); } };
  }
  const server = createAudioServiceApp({ transcriber }).listen(env.AUDIO_SERVICE_PORT, '127.0.0.1', () => log.info({ port: env.AUDIO_SERVICE_PORT }, 'Audio service started'));
  const stop = () => { server.close(); transcriber.close?.(); };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
}
