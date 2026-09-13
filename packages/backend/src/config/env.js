import { z } from 'zod';

/**
 * Флаги окружения: z.coerce.boolean() считает истиной любую непустую строку, поэтому "0" включал бы бота.
 * Истина — только 1/true/yes/on (регистр не важен).
 */
const flag = (defaultValue = false) => z.preprocess(
  (value) => (typeof value === 'string' ? ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase()) : value ?? defaultValue),
  z.boolean().default(defaultValue),
);

/**
 * Интерпретатор Python из venv, который создаёт `npm run setup:audio`:
 * на Windows venv кладёт его в Scripts\python.exe, на Linux и macOS — в bin/python.
 * @param {NodeJS.Platform} [platform]
 */
export function defaultVoskPython(platform = process.platform) {
  return platform === 'win32' ? './.venv-audio/Scripts/python.exe' : './.venv-audio/bin/python';
}

const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  PUBLIC_URL: z.string().url().default('https://doc3steps.example.ru'),
  DATA_DIR: z.string().default('./data'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DEBUG_COMMANDS: flag(false),


  // AI
  AI_PROVIDER: z.enum(['openai-compat', 'opencode', 'mock']).default('openai-compat'),

  // OpenCode CLI (бесплатные модели OpenCode Zen)
  OPENCODE_RUNTIME: z.enum(['local', 'docker', 'podman']).default('local'),
  OPENCODE_BIN: z.string().default('opencode'),
  OPENCODE_IMAGE: z.string().default('doc3steps-opencode'),
  OPENCODE_MODEL: z.string().default(''),
  OPENCODE_AGENT: z.string().default('doc-editor'),
  // Бесплатные модели не держат параллельные запросы с одного адреса: второй зависает до таймаута
  OPENCODE_MAX_PARALLEL: z.coerce.number().int().min(1).max(8).default(1),
  AI_BASE_URL: z.string().url().default('http://localhost:11434/v1'),
  AI_API_KEY: z.string().default(''),
  AI_MODEL: z.string().default('qwen2.5:7b-instruct'),
  AI_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.1),
  AI_TIMEOUT_MS: z.coerce.number().positive().default(90000),
  AI_FAULT: z.enum(['off', 'always']).default('off'),

  // MAX bot
  MAX_ENABLED: flag(false),
  MAX_TOKEN: z.string().optional(),
  MAX_API_URL: z.string().url().default('https://platform-api2.max.ru'),
  MAX_MODE: z.enum(['webhook', 'polling']).default('webhook'),
  MAX_WEBHOOK_SECRET: z.string().optional(),
  // API MAX работает на сертификате УЦ Минцифры, которого нет в Node.js и Windows (источник — gosuslugi.ru/crt)
  MAX_CA_FILE: z.string().default('certs/russian_trusted_root_ca.pem'),

  // VK bot
  VK_ENABLED: flag(false),
  VK_GROUP_ID: z.string().optional(),
  VK_TOKEN: z.string().optional(),
  VK_API_VERSION: z.string().default('5.199'),
  VK_MODE: z.enum(['callback', 'longpoll']).default('callback'),
  VK_CALLBACK_SECRET: z.string().optional(),
  VK_CONFIRMATION_CODE: z.string().optional(),

  // API Key authentication for Document Service
  API_KEY: z.string().default(''),
  AUDIO_SERVICE_PORT: z.coerce.number().default(3005),
  AUDIO_MAX_BYTES: z.coerce.number().int().positive().default(25 * 1024 * 1024),
  VOSK_MODEL_PATH: z.string().default('./models/vosk-model-small-ru-0.22'),
  FFMPEG_BIN: z.string().default('ffmpeg'),
  // Пустое значение — интерпретатор venv для текущей ОС
  VOSK_PYTHON: z.string().optional().transform((value) => value || defaultVoskPython()),
  // Остаток совместимости для внешнего REST-клиента; внутренние адаптеры работают напрямую.
  DOCUMENT_POLL_INTERVAL_MS: z.coerce.number().positive().default(5000),

  // Cleanup
  CLEANUP_ENABLED: flag(true),
  CLEANUP_INTERVAL_MS: z.coerce.number().positive().default(60 * 60 * 1000),
  CLEANUP_FILE_MAX_AGE_HOURS: z.coerce.number().positive().default(24),
  CLEANUP_LOG_MAX_AGE_DAYS: z.coerce.number().positive().default(30),
});

function loadEnv() {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map(i => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }

  const env = parsed.data;

  // Без API_KEY межсервисная аутентификация выключена, а значит сервисы ботов не смогут
  // действовать от имени пользователя. В разработке это допустимо (предупреждение при старте),
  // на проде — нет: пустой ключ однажды уедет на сервер и откроет чужие документы.
  if (env.NODE_ENV === 'production' && !env.API_KEY) {
    throw new Error(
      'NODE_ENV=production requires API_KEY. ' +
      'Generate one with: node -e "console.log(crypto.randomBytes(32).toString(\'hex\'))" ' +
      'and set it for the backend process.'
    );
  }

  // Cross-field validation: MAX_ENABLED requires MAX_TOKEN
  if (env.MAX_ENABLED && !env.MAX_TOKEN) {
    throw new Error(
      'MAX_ENABLED=1 but MAX_TOKEN is not set. ' +
      'Provide MAX_TOKEN with a valid API token to enable MAX bot integration.'
    );
  }

  // Cross-field validation: MAX webhook requires a secret
  if (env.MAX_ENABLED && env.MAX_MODE === 'webhook' && !env.MAX_WEBHOOK_SECRET) {
    throw new Error('MAX_MODE=webhook requires MAX_WEBHOOK_SECRET (5-256 chars of A-Za-z0-9_-).');
  }

  // Cross-field validation: VK callback requires secret and confirmation string
  if (env.VK_ENABLED && env.VK_MODE === 'callback' && (!env.VK_CALLBACK_SECRET || !env.VK_CONFIRMATION_CODE)) {
    throw new Error('VK_MODE=callback requires VK_CALLBACK_SECRET and VK_CONFIRMATION_CODE.');
  }

  // Cross-field validation: VK_ENABLED requires VK_GROUP_ID
  if (env.VK_ENABLED && !env.VK_GROUP_ID) {
    throw new Error('VK_ENABLED=1 but VK_GROUP_ID is not set.');
  }

  // Cross-field validation: VK_ENABLED requires VK_TOKEN
  if (env.VK_ENABLED && !env.VK_TOKEN) {
    throw new Error(
      'VK_ENABLED=1 but VK_TOKEN is not set. ' +
      'Provide VK_TOKEN with a valid API token to enable VK bot integration.'
    );
  }

  return env;
}

export const env = loadEnv();
