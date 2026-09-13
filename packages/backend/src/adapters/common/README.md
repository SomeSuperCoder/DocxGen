# Общие утилиты адаптеров

Код, общий для [MAX](../max/README.md) и [ВКонтакте](../vk/README.md). Здесь нет ничего платформенного: только правила, одинаковые для любого мессенджера. Новый адаптер (например, Telegram) стоит собирать из этих же модулей.

| Модуль | Экспорт | Назначение |
|--------|---------|------------|
| `peerQueue.js` | `createPeerQueue({ intervalMs })` | Очередь отправки на собеседника: сообщения одному пользователю уходят строго по порядку и с паузой, разные собеседники не ждут друг друга. Ошибка задачи возвращается вызывающему коду и не обрывает очередь |
| `splitText.js` | `splitText(text, limit = 4000)` | Делит длинный текст на части: сначала по абзацам, потом по строкам, потом по пробелам |
| `markup.js` | `plainText(reply)`, `htmlToPlain`, `markdownToPlain` | Убирает HTML- и Markdown-разметку для платформ без форматирования и раскрывает HTML-сущности |
| `buttons.js` | `payloadOf(button)` | Полезная нагрузка кнопки: готовая строка из `bot/keyboards.js` или объект `{ a, v, r }`, закодированный через `bot/payload.js` |
| `botImages.js` | `createBotImages({ dir })` | Загружает иллюстрации из `assets/bot/*.png`. Ключ кеша `имя@sha256` меняется при перерисовке картинки, и устаревший токен вложения не отправится |

## Контракт адаптера

Любой адаптер возвращает объект:

```js
{
  platform: 'max' | 'vk' | ...,
  async send(peerId, replies, { event }) { ... },
  getProfile?(userId),   // необязательно: имя пользователя, если платформа не присылает его в событии
}
```

Ответ движка (`reply`) выглядит так:

```js
{
  text: '...',
  format: 'html' | 'markdown' | undefined,
  buttons: [[{ label, action, style?, type?: 'link' | 'open_app', url?, webApp? }]],
  image: { name: 'greeting' },
  file: { fileId, caption },
}
```

Входящее событие (`InboundEvent`), которое адаптер передаёт диспетчеру:

```js
{ platform, kind: 'text' | 'command' | 'action' | 'audio', eventId, peerId, userId, text? | command? | action? | audio?, profile?, meta }
```

`eventId` должен быть стабильным: по нему диспетчер отбрасывает повторную доставку того же события.
