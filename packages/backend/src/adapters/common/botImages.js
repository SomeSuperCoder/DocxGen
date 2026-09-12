import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Иллюстрации сообщений бота: PNG рядом с SVG-исходниками (assets/bot/src). */
export const BOT_IMAGES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../assets/bot');

const SAFE_NAME = /^[a-z0-9-]{1,40}$/;

/**
 * Загрузчик иллюстраций для адаптеров. Ответ бота несёт только имя ({ image: { name } }),
 * а адаптер загружает файл в мессенджер и кеширует токен в template_assets.
 *
 * cacheKey содержит хеш содержимого: перерисованная картинка получает новый ключ,
 * и старый токен из кеша больше не отправляется.
 *
 * @param {{ dir?: string }} [options]
 * @returns {{ load: (name: string) => Promise<{ buffer: Buffer, filename: string, cacheKey: string } | null> }}
 */
export function createBotImages({ dir = BOT_IMAGES_DIR } = {}) {
  return {
    async load(name) {
      if (!SAFE_NAME.test(String(name))) return null;
      const filename = `${name}.png`;
      const buffer = await fs.readFile(path.join(dir, filename)).catch(() => null);
      if (!buffer) return null;
      const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 12);
      return { buffer, filename, cacheKey: `${name}@${hash}` };
    },
  };
}
