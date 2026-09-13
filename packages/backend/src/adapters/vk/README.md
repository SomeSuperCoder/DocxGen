# Адаптер ВКонтакте

Подключает бота сообщества ВКонтакте к общему диалоговому движку ([src/bot](../../bot/README.md)). Работа с API ВК идёт через [vk-io](https://github.com/negezor/vk-io).

## Файлы

| Файл | Назначение |
|------|------------|
| `client.js` | Обёртка vk-io: `messages.send`, загрузка документов и фото, признак повторяемой ошибки |
| `normalize.js` | `toInboundEvent(body)` — событие `message_new` → `InboundEvent` |
| `adapter.js` | `createVkAdapter()` — отправка текста, клавиатур, иллюстраций и DOCX; имя пользователя через `users.get` |
| `render.js` | Ответ движка → параметры `messages.send`: простой текст, inline-клавиатура, части по 4000 символов |
| `randomId.js` | Детерминированный `random_id` из ключа — повторная отправка не дублирует сообщение |
| `longpoll.js` | Bots Long Poll API для локальной работы |
| `callback.js` | Роутер `POST /integrations/vk/callback` для сервера с HTTPS |

## Режимы получения событий

| `VK_MODE` | Когда | Как работает |
|-----------|-------|--------------|
| `longpoll` | Локально, без домена | `groups.getLongPollServer` → `a_check` с ожиданием 25 с; при `failed: 2/3` переподключение |
| `callback` | На сервере с HTTPS | ВК шлёт POST на `/integrations/vk/callback`. Проверяются `group_id` и `secret`, на `confirmation` возвращается `VK_CONFIRMATION_CODE` |

Как и у MAX, событие сначала сохраняется (`dispatcher.accept`), а обрабатывается асинхронно.

## Что обрабатывается

Только `message_new` из личных сообщений: беседы (`peer_id >= 2000000000`) и сообщения от сообществ игнорируются.

- `payload` кнопки → действие движка (`action`); кнопка «Начать» → команда `start`;
- `/start`, `/help`, `/new`, «начать», «новый документ», `/ai_fail` → команды;
- вложение `audio_message` → голосовое на распознавание (ссылка `link_ogg`/`link_mp3`);
- остальное → текст черновика.

## Отправка

- ВК не поддерживает разметку: HTML-теги из текстов движка убираются (`common/markup.js`).
- Клавиатура inline, подписи кнопок обрезаются до 40 символов, цвета `primary`/`secondary`/`negative`. Если клиент не поддерживает inline-клавиатуры, варианты дописываются в текст списком «1 — …».
- Очередь на собеседника с паузой 350 мс. Ошибки API 6, 9 и 10 (лимиты) повторяются через 1, 2 и 4 с.
- DOCX загружается как документ сообщения, доставка идемпотентна (`core/deliveries.js`).
- Иллюстрации загружаются как фото один раз, строка вложения кешируется в `template_assets`.

## Настройка

```env
VK_ENABLED=1
VK_GROUP_ID=123456789
VK_TOKEN=vk1.a....
VK_API_VERSION=5.199
VK_MODE=longpoll            # или callback
VK_CALLBACK_SECRET=         # для callback
VK_CONFIRMATION_CODE=       # для callback
```

Ключу сообщества нужны права «сообщения сообщества», «файлы», «фотографии» и «управление сообществом». В типах событий Long Poll или Callback API должно быть включено **«Входящее сообщение»**.

## Отладка

```bash
pnpm --filter @docxgen/backend vk:poll   # сырые события Long Poll (остановите pnpm dev)
```

- ошибка `15` или `7` — у ключа нет нужного права;
- `901` — пользователь не разрешил сообщения от сообщества.

Не включайте Long Poll и Callback API одновременно, иначе события обработаются дважды.

Тесты: `tests/unit/vk-client.test.js`, `tests/fixtures/vk/`. Пошаговое создание сообщества: [docs/bots-setup.md](../../../../../docs/bots-setup.md).
