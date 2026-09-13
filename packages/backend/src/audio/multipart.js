import { DomainError } from '../core/errors.js';

/**
 * Поле `file` из multipart/form-data без сторонних зависимостей.
 * Нужен и аудиосервису, и маршруту backend, который принимает запись с сайта.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {number} maxBytes
 * @returns {Promise<Buffer>}
 */
export function readMultipartFile(req, maxBytes) {
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
