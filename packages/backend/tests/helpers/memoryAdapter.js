import { DeliveryError } from '../../src/core/errors.js';

/**
 * Тестовый адаптер мессенджера: вместо отправки складывает ответы бота в память.
 * Подключается к тому же диспетчеру, что MAX и ВК, поэтому сквозные тесты проходят
 * весь путь бота — диалог, ИИ, реквизиты, DOCX — без токенов платформ.
 */
export function createMemoryAdapter({ platform = 'max', files }) {
  const messages = [];
  const failNextFile = new Set();

  return {
    platform,
    messages,
    /** Следующая отправка DOCX этому собеседнику завершится ошибкой доставки. */
    armFileFailure(peerId) { failNextFile.add(peerId); },
    async send(peerId, replies) {
      for (const reply of replies) {
        if (reply.file) {
          const file = files.get(reply.file.fileId);
          if (!file || failNextFile.delete(peerId)) {
            throw new DeliveryError(reply.file.fileId, new Error(file ? 'имитация сбоя отправки' : 'файл не найден'));
          }
          messages.push({ peerId, ...reply, file: { ...reply.file, path: file.path, filename: file.filename } });
        } else {
          messages.push({ peerId, ...reply });
        }
      }
    },
  };
}
