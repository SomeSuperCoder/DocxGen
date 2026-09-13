# OpenCode — ИИ-провайдер по умолчанию

Конфигурация [OpenCode CLI](https://opencode.ai) для `AI_PROVIDER=opencode`. Бесплатные модели OpenCode Zen не требуют API-ключа. Провайдер в коде: `src/ai/providers/opencodeCli.js`.

## Содержимое

| Файл | Назначение |
|------|------------|
| `.opencode/agents/doc-editor.md` | Агент «редактор служебных документов»: системные инструкции, модель по умолчанию `opencode/mimo-v2.5-free`, все инструменты выключены, ответ только JSON |
| `opencode.json` | Агент по умолчанию `doc-editor`, запрет на правку файлов, bash и webfetch |
| `Dockerfile` | Образ `node:24-bookworm-slim` + `opencode-ai` для запуска в контейнере |

## Варианты запуска

**Локально** (`OPENCODE_RUNTIME=local`):

```bash
npm i -g opencode-ai
pnpm --filter @docxgen/backend opencode:check
```

**В контейнере** (`OPENCODE_RUNTIME=docker` или `podman`):

```bash
pnpm --filter @docxgen/backend opencode:build   # образ doc3steps-opencode
```

## Настройка

| Переменная | По умолчанию | Назначение |
|------------|--------------|------------|
| `OPENCODE_RUNTIME` | `local` | `local`, `docker` или `podman` |
| `OPENCODE_BIN` | `opencode` | Путь к CLI для `local` |
| `OPENCODE_IMAGE` | `doc3steps-opencode` | Образ для контейнерного запуска |
| `OPENCODE_AGENT` | `doc-editor` | Агент |
| `OPENCODE_MODEL` | модель из агента | Переопределение модели |
| `OPENCODE_MAX_PARALLEL` | `1` | Одновременные запросы: бесплатные модели не держат параллельные запросы с одного адреса |
| `AI_TIMEOUT_MS` | `180000` | Таймаут запроса |

Корневой `Containerfile` и каталог `container/` собирают другой образ, `docxgen-opencode` с агентом `document-analyst`, через `build.sh`. Backend по умолчанию использует образ из этого каталога.

Подробнее о пайплайне: [docs/ai.md](../../../docs/ai.md).
