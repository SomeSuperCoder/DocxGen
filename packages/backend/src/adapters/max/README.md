# Адаптер MAX

Подключает чат-бота мессенджера MAX к общему диалоговому движку ([src/bot](../../bot/README.md)). Адаптер только переводит события MAX в формат движка и отправляет ответы обратно. Логики документов в нём нет.

## Файлы

| Файл | Назначение |
|------|------------|
| `client.js` | HTTP-клиент Bot API MAX: `/me`, `/messages`, `/answers`, `/updates`, `/subscriptions`, загрузка файлов через `/uploads` |
| `normalize.js` | `toInboundEvents(update)` — Update MAX → массив `InboundEvent` |
| `adapter.js` | `createMaxAdapter()` — отправка ответов: текст, клавиатуры, иллюстрации, DOCX, ответ на нажатие кнопки |
| `render.js` | Ответ движка → тело сообщения MAX: разбиение на части по 4000 символов, inline-клавиатура |
| `poller.js` | Long polling `GET /updates` для локальной работы |
| `webhook.js` | Роутер `POST /integrations/max/webhook` для сервера с HTTPS |

## Режимы получения событий

| `MAX_MODE` | Когда | Как работает |
|------------|-------|--------------|
| `polling` | Локально, без домена | `poller.js` держит запрос `/updates` до 30 с и запоминает `marker` |
| `webhook` | На сервере с HTTPS | MAX шлёт POST на `${PUBLIC_URL}/integrations/max/webhook`, секрет проверяется по заголовку `X-Max-Bot-Api-Secret` |

В обоих режимах обработчик не ждёт завершения обработки: событие сохраняется (`dispatcher.accept`), а обработка идёт асинхронно (`dispatcher.run`). Порядок сообщений в рамках одного диалога соблюдает диспетчер.

## Что обрабатывается

- `bot_started` → команда `start`;
- `message_created` → текст, команда (`/start`, `/help`, `/new`, «начать», «помощь», «новый документ», `/ai_fail`) или аудио;
- `message_callback` → нажатие inline-кнопки.

Групповые чаты, сообщения ботов и неизвестные типы событий отбрасываются.

**Голос.** Bot API MAX не передаёт боту содержимое голосовых сообщений: событие приходит без чата и отправителя. Поэтому запись можно прислать **аудиофайлом** (`.m4a`, `.mp3`, `.ogg`, `.opus`, `.wav` и др.), и он уйдёт на распознавание.

## Отправка

- Сообщения одному собеседнику уходят последовательно, с паузой 600 мс (`peerQueue`).
- При 429 и 5xx — повтор через 1, 2 и 4 с.
- DOCX загружается через `/uploads`, после чего отправляется с повторами, пока MAX отвечает `attachment.not.ready`. Доставка идемпотентна (`core/deliveries.js`).
- Иллюстрации загружаются один раз, токен кешируется в таблице `template_assets` по ключу `имя@хеш`.
- При нажатии кнопки исходное сообщение получает отметку «✓ …» и теряет клавиатуру. Вложения сохраняются по токенам.
- Разметка: HTML отправляется как есть (`format: 'html'`).
- Кнопки: `callback`, `link` и `open_app`. Последняя открывает мини-приложение: `MAX_MINI_APP_URL` и `MAX_MINI_APP_BOT`.

## Настройка

```env
MAX_ENABLED=1
MAX_TOKEN=...
MAX_API_URL=https://platform-api2.max.ru
MAX_MODE=polling            # или webhook
MAX_WEBHOOK_SECRET=...      # для webhook
MAX_CA_FILE=certs/russian_trusted_root_ca.pem
MAX_MINI_APP_URL=           # по умолчанию ${PUBLIC_URL}/#/new?maxApp=1
MAX_MINI_APP_BOT=
```

API MAX использует сертификат УЦ Минцифры, которого нет в Node.js. Адаптер добавляет его из `MAX_CA_FILE` при старте.

## Отладка

```bash
pnpm --filter @docxgen/backend max:subscribe -- --me      # проверить токен
pnpm --filter @docxgen/backend max:subscribe              # подписать вебхук на PUBLIC_URL
pnpm --filter @docxgen/backend max:subscribe -- --list    # активные подписки
pnpm --filter @docxgen/backend max:subscribe -- --delete  # снять подписку
pnpm --filter @docxgen/backend max:poll                   # сырые события (остановите pnpm dev)
```

Если активна подписка на вебхук, polling событий не получает. Перед локальной работой снимите её командой `--delete`.

Тесты: `tests/unit/max-client.test.js`, `tests/fixtures/max/`. Пошаговое создание бота: [docs/bots-setup.md](../../../../../docs/bots-setup.md).
