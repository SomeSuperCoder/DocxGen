# Распознавание речи (Vosk)

Модуль переводит русскую речь в текст. Им пользуются микрофон в веб-версии и голосовые сообщения ботов. Модель Vosk загружается один раз в отдельном процессе — **аудиосервисе**, а backend и боты обращаются к нему по HTTP.

```
сайт ─► backend /api/audio/transcribe ─┐
бот (ВК голосовое, MAX аудиофайл) ─────┼─► аудиосервис 127.0.0.1:3005 ─► ffmpeg ─► Python + Vosk
                                        ┘
```

## Файлы

| Файл | Назначение |
|------|------------|
| `../audio-service.js` | Процесс аудиосервиса на Express: `GET /health`, `POST /api/audio/transcribe` |
| `transcriber.js` | `decodeAudio()` — любой формат через ffmpeg → PCM 16 кГц моно; `createVoskTranscriber()` — управление Python-процессом |
| `transcriber.py` | Процесс Vosk: читает PCM построчно из stdin, отвечает JSON в stdout |
| `audioClient.js` | HTTP-клиент аудиосервиса для backend |
| `botAudio.js` | Для ботов: достаёт ссылку из вложения, скачивает файл с ограничением размера и отправляет на распознавание |
| `multipart.js` | Разбор поля `file` из `multipart/form-data` без зависимостей |

## Установка

Нужны Python 3 и `ffmpeg` в `PATH`. Из корня репозитория:

```bash
pnpm setup:audio
```

Скрипт создаёт `packages/backend/.venv-audio`, ставит пакет `vosk` и скачивает модель `vosk-model-small-ru-0.22`, если её ещё нет.

Запуск: `pnpm start:audio` из корня (или в составе `pnpm dev` / `pnpm start`).

## API аудиосервиса

```http
POST /api/audio/transcribe
X-Owner-Platform: web | max | vk
X-Owner-Id: <id>
X-Api-Key: <API_KEY>          # если API_KEY задан
Content-Type: multipart/form-data  (поле file)
```

Ответ: `{ "ok": true, "text": "...", "duration": 3.2 }`. Ошибка: `{ "error": { "code": "AUDIO_INVALID" | "STT_FAILED" | "UNAUTHORIZED", "message": "..." } }`.

## Настройка

| Переменная | По умолчанию | Назначение |
|------------|--------------|------------|
| `AUDIO_SERVICE_PORT` | `3005` | Порт, сервис слушает только `127.0.0.1` |
| `VOSK_MODEL_PATH` | `./models/vosk-model-small-ru-0.22` | Путь к модели относительно `packages/backend` |
| `VOSK_PYTHON` | Python из `.venv-audio` | Интерпретатор с установленным `vosk` |
| `FFMPEG_BIN` | `ffmpeg` | Путь к ffmpeg |
| `AUDIO_MAX_BYTES` | 25 МБ | Максимальный размер файла |

## Устойчивость

- Если модель или Vosk не установлены, аудиосервис всё равно стартует и отвечает понятной ошибкой `STT_FAILED`, а не падает. Иначе прокси Vite вернул бы невнятный 502.
- Если Python-процесс завершился, его запросы завершаются ошибкой, а следующий запрос запускает процесс заново.
- Файл передаётся в ffmpeg через временный файл, а не через pipe: у MP4/M4A (iPhone, Safari) индекс лежит в конце файла.
- Недоступность сервиса для пользователя выглядит как `STT_UNAVAILABLE` («Сервис распознавания речи недоступен»).

Тесты: `tests/unit/botAudio.test.js`, `tests/fixtures/audio/` (фейковый Vosk). Подробнее: [docs/audio-service.md](../../../../docs/audio-service.md).
