# @docxgen/frontend — веб-версия DocxGen

Одностраничное приложение, через которое пользователь превращает черновик в готовый документ Word. Эта же сборка работает как мини-приложение внутри MAX.

**Стек:** React 19, TypeScript 6, Vite 8, Tailwind CSS 4, Redux Toolkit, Radix UI, Framer Motion, Vitest.

## Что умеет

- **Лендинг** (`/`): описание сервиса, примеры черновиков, каталог типов документов и превью шаблонов.
- **Редактор** (`/#/new`): три шага — черновик → тип и шаблон → проверка и экспорт.
  - ввод черновика текстом или голосом (микрофон → аудиосервис Vosk через backend);
  - помощник черновика, автосохранение, горячие клавиши;
  - просмотр исправлений ИИ и сравнение с исходным текстом;
  - форма реквизитов с подсветкой незаполненных и сомнительных полей;
  - живой предпросмотр документа и скачивание DOCX.
- Светлая и тёмная темы, адаптивная вёрстка, поддержка `prefers-reduced-motion`.
- **Мини-приложение MAX:** при `?maxApp=1` в адресе (или user-agent MAX) интерфейс упрощается под встроенный браузер мессенджера.

Маршрутизация сделана на хэше (`/#/new`), поэтому собранный фронтенд можно раздавать любым статическим сервером без правил переписывания путей.

## Быстрый старт

Из корня репозитория (нужны Node.js 22+ и pnpm 10):

```bash
pnpm install
pnpm dev
```

Корневой `pnpm dev` поднимает backend, аудиосервис и Vite одновременно. Только фронтенд:

```bash
pnpm --filter @docxgen/frontend dev
```

Приложение откроется на http://127.0.0.1:5173. Vite проксирует `/api` и `/health` на backend. Порт берётся из `PORT` в корневом `.env`, по умолчанию `3000`.

## Скрипты

| Команда | Что делает |
|---------|------------|
| `pnpm dev` | Сервер разработки Vite с HMR |
| `pnpm build` | Проверка типов (`tsc -b`) и продакшн-сборка в `dist/` |
| `pnpm preview` | Локальный просмотр собранного `dist/` |
| `pnpm typecheck` | Только проверка типов |
| `pnpm lint` | Линтер Oxlint |
| `pnpm exec vitest run` | Юнит-тесты компонентов, стора и утилит |

Команды выполняются в `packages/frontend` или через `pnpm --filter @docxgen/frontend <команда>`.

## Структура

```
src/
├── main.tsx              # Точка входа, Redux Provider
├── App.tsx               # Лендинг / редактор по хэш-маршруту
├── components/
│   ├── Landing.tsx           # Главная страница
│   ├── DocumentGenerator.tsx # Редактор (загружается лениво)
│   ├── DraftSection.tsx      # Шаг 1: черновик, голосовой ввод
│   ├── DraftAssistant.tsx    # Подсказки по черновику
│   ├── CorrectedSection.tsx  # Исправленный ИИ текст
│   ├── ChangeReview.tsx      # Сравнение с исходником
│   ├── RequisitesForm.tsx    # Реквизиты документа
│   ├── DocumentPreview.tsx   # Предпросмотр
│   ├── ResultExport.tsx      # Скачивание DOCX
│   ├── ProductPanels.tsx     # Панели продукта, режим мини-приложения MAX
│   └── ui/                   # Базовые компоненты (button, card, select, textarea)
├── store/documentSlice.ts # Состояние документа и запросы к API
├── lib/                   # Хуки маршрута, темы, микрофона; константы и утилиты
└── types/document.ts      # Типы ответов API
public/                    # Шрифты (OFL), изображения, favicon
```

## Работа с backend

Весь обмен идёт через REST API backend, полный справочник — в [docs/api.md](../../docs/api.md). Основной сценарий:

1. `GET /api/catalog` — типы документов и шаблоны;
2. `POST /api/documents` → `POST /api/documents/:id/process` — создание и запуск ИИ-обработки;
3. опрос `GET /api/documents/:id` до готовности;
4. `PUT /api/documents/:id/fields` → `POST /api/documents/:id/render` → `GET /api/files/:fileId`.

Пользователь определяется по cookie сессии, регистрация не нужна.

## Продакшн

`pnpm build` собирает статику в `packages/frontend/dist`. Backend статику не раздаёт, поэтому на сервере нужен обратный прокси (nginx, Caddy):

- `/` → файлы из `dist/`;
- `/api`, `/health`, `/integrations` → backend (`http://127.0.0.1:3000`).

Для мини-приложения MAX укажите публичный адрес в `MAX_MINI_APP_URL`, по умолчанию `${PUBLIC_URL}/#/new?maxApp=1`.
