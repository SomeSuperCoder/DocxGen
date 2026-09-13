# @docxgen/backend — backend DocxGen

Единый backend на Node.js: HTTP API для веб-версии, очередь задач, ИИ-обработка черновиков, рендер DOCX по ГОСТ Р 7.0.97-2016 и боты MAX и ВКонтакте. Мессенджеры — не отдельные сервисы, а транспортные адаптеры внутри этого же процесса: у всех каналов общие сервис документов, база и воркер.

**Стек:** Node.js 22+ (ES-модули), Express 5, better-sqlite3, docx, zod, pino, vk-io, OpenAI SDK, Vitest.

## Процессы

| Процесс | Команда | Порт | Назначение |
|---------|---------|------|------------|
| Backend | `pnpm start` | `PORT` (3000) | API, воркер, адаптеры ботов |
| Аудиосервис | `pnpm start:audio-service` | `AUDIO_SERVICE_PORT` (3005), только `127.0.0.1` | Распознавание речи Vosk — [подробнее](src/audio/README.md) |

Оба процесса читают корневой `.env` (`node --env-file-if-exists=../../.env`). Из корня репозитория их вместе запускает `pnpm start`, а `pnpm dev` добавляет к ним фронтенд.

## Быстрый старт

```bash
# из корня репозитория
pnpm install
pnpm setup:env      # мастер .env: порт, провайдер ИИ, боты
pnpm setup:audio    # опционально: Python venv + Vosk + русская модель
pnpm start
```

Проверка: `curl http://localhost:3000/health`.

## Скрипты

| Команда | Что делает |
|---------|------------|
| `pnpm start` | Запуск backend |
| `pnpm dev` | Backend с перезапуском при изменениях (`--watch`) |
| `pnpm start:audio-service` | Запуск аудиосервиса |
| `pnpm setup:audio` | Установка Vosk и модели `vosk-model-small-ru-0.22` |
| `pnpm test` | Все тесты (Vitest: unit + integration) |
| `pnpm eval` | Прогон демо-кейсов `demo/cases` через настроенный провайдер ИИ |
| `pnpm opencode:check` | Проверка, что OpenCode CLI отвечает |
| `pnpm opencode:build` | Сборка Docker-образа OpenCode — [подробнее](opencode/README.md) |
| `pnpm max:subscribe` | Подписка вебхука MAX (`--me`, `--list`, `--delete`) |
| `pnpm max:poll` | Печать сырых событий MAX (отладка) |
| `pnpm vk:poll` | Печать сырых событий ВК Long Poll (отладка) |
| `pnpm bot:images` | Перерисовка PNG-иллюстраций бота из SVG в `assets/bot/src` |

## Архитектура

Слои (каждый знает только нижележащий):

```
HTTP API / адаптеры ботов → диспетчер + диалоговый движок → documentService → очередь/воркер → ИИ, DOCX, SQLite
```

Все модули связываются в `src/runtime.js` (composition root), точка входа — `src/server.js`.

```
src/
├── server.js / runtime.js / app.js   # Вход, сборка зависимостей, Express-приложение
├── audio-service.js                  # Отдельный процесс распознавания речи
├── config/        # env.js (схема .env на zod), доверенный сертификат для MAX
├── http/          # REST-маршруты, сессии по cookie, API-ключ, rate limit, ошибки
├── core/          # documentService — жизненный цикл документа, версии, доставки файлов
├── jobs/          # Очередь на SQLite, воркер, обработчики process и cleanup
├── ai/            # Промпт, определение типа, processDraft, провайдеры (opencode, openai, mock)
├── validation/    # Нормализация и проверка реквизитов, обоснование полей цитатами
├── docx/          # Рендер OOXML: блоки, форматированный текст, единицы измерения
├── catalog/       # Загрузка типов документов и шаблонов из config/
├── features/      # Импорт пользовательских DOCX-бланков
├── storage/       # Файловое хранилище в DATA_DIR
├── db/            # Подключение SQLite и миграции
├── client/        # Клиент сервиса документов для ботов (in-process или HTTP)
├── bot/           # Диалоговый движок — src/bot/README.md
├── adapters/      # MAX, ВК, общие утилиты — src/adapters/*/README.md
└── audio/         # Клиент и транскрайбер Vosk — src/audio/README.md
config/
├── doc-types/     # 9 типов документов (*.json)
└── templates/     # Шаблоны оформления (классический, современный)
assets/bot/        # Иллюстрации сообщений бота (PNG + SVG-исходники)
certs/             # Корневой сертификат УЦ Минцифры для API MAX
demo/cases/        # Кейсы для pnpm eval
opencode/          # Агент doc-editor и Dockerfile OpenCode
scripts/           # Служебные скрипты (см. таблицу выше)
tests/             # unit/, integration/, fixtures/, helpers/
```

### Подмодули

| Модуль | README |
|--------|--------|
| Диалоговый движок ботов | [src/bot](src/bot/README.md) |
| Адаптер MAX | [src/adapters/max](src/adapters/max/README.md) |
| Адаптер ВКонтакте | [src/adapters/vk](src/adapters/vk/README.md) |
| Общие утилиты адаптеров | [src/adapters/common](src/adapters/common/README.md) |
| Распознавание речи | [src/audio](src/audio/README.md) |
| OpenCode | [opencode](opencode/README.md) |

## Конфигурация

Все переменные с комментариями описаны в [.env.example](../../.env.example). Основные:

| Переменная | По умолчанию | Назначение |
|------------|--------------|------------|
| `PORT` / `PUBLIC_URL` | `3000` / `http://localhost:3000` | Порт и публичный адрес (нужен для вебхуков и мини-приложения) |
| `DATA_DIR` | `./data` | SQLite (`app.sqlite`), файлы DOCX, логи |
| `LOG_LEVEL` | `info` | `debug` — события ботов, переходы диалога, тайминги ИИ |
| `AI_PROVIDER` | `opencode` | `opencode`, `openai` или `mock` |
| `AI_TIMEOUT_MS` | `180000` | Таймаут одного запроса к ИИ |
| `OPENCODE_RUNTIME` | `local` | `local`, `docker` или `podman` |
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | — | Для `AI_PROVIDER=openai` (любой совместимый API) |
| `MAX_ENABLED` / `VK_ENABLED` | `0` | Включение ботов |
| `CLEANUP_*` | включено, 24 ч / 30 дн. | Удаление старых файлов и логов |
| `API_KEY` | — | Ключ для внешних HTTP-интеграций и аудиосервиса |
| `DEBUG_COMMANDS` | `1` | Команда `/ai_fail` для имитации сбоя ИИ; на публичном сервере выключите |

## Тесты

```bash
pnpm test                        # всё
pnpm exec vitest run tests/unit  # только юнит-тесты
```

Интеграционные тесты поднимают runtime с временной базой и провайдером `mock`, внешние сервисы не нужны.

## Развёртывание

- Нужны Node.js 22+, для голоса — Python 3 и `ffmpeg`.
- `DATA_DIR` должен лежать на постоянном диске: там база и сгенерированные файлы.
- Для вебхуков MAX и Callback API ВК нужен HTTPS-домен в `PUBLIC_URL`.
- Backend и аудиосервис лучше запускать как постоянные сервисы (systemd, pm2). Обратный прокси раздаёт `packages/frontend/dist` и проксирует `/api`, `/health`, `/integrations` на `PORT`.

Подробнее: [архитектура](../../docs/architecture.md), [API](../../docs/api.md), [ИИ](../../docs/ai.md), [настройка ботов](../../docs/bots-setup.md), [ограничения](../../docs/limitations.md).
