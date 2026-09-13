#!/usr/bin/env node
/** Interactive .env setup wizard for DocxGen. Usage: pnpm setup:env */
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const isTTY = process.stdout.isTTY;
const c = { reset: isTTY ? '\x1b[0m' : '', bold: isTTY ? '\x1b[1m' : '', dim: isTTY ? '\x1b[2m' : '', green: isTTY ? '\x1b[32m' : '', yellow: isTTY ? '\x1b[33m' : '', cyan: isTTY ? '\x1b[36m' : '', red: isTTY ? '\x1b[31m' : '', magenta: isTTY ? '\x1b[35m' : '' };
const ENV_PATH = path.resolve(__dirname, '..', '.env');

function createRL() { return readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true }); }

function ask(rl, q, def = '') {
  const suffix = def !== '' ? ` ${c.dim}[${def}]${c.reset}` : '';
  return new Promise((resolve) => {
    rl.question(`${c.cyan}?${c.reset} ${q}${suffix}: `, (a) => resolve(a.trim() === '' ? def : a.trim()));
  });
}

async function askYesNo(rl, q, def = false) {
  const a = await ask(rl, `${q} (${def ? 'Y/n' : 'y/N'})`, def ? 'y' : 'n');
  return a.toLowerCase().startsWith('y');
}

function askSecret(rl, q) {
  return new Promise((resolve) => {
    const stdin = process.stdin; const wasRaw = stdin.isRaw;
    if (stdin.isTTY) stdin.setRawMode(true);
    process.stdout.write(`${c.cyan}?${c.reset} ${q}: `);
    let val = '';
    const onData = (ch) => {
      const k = ch.toString();
      if (k === '\n' || k === '\r') { if (stdin.isTTY) stdin.setRawMode(wasRaw ?? false); stdin.removeListener('data', onData); process.stdout.write('\n'); resolve(val.trim()); }
      else if (k === '\u007F' || k === '\b') { if (val.length > 0) { val = val.slice(0, -1); process.stdout.write('\b \b'); } }
      else if (k === '\u0003') { if (stdin.isTTY) stdin.setRawMode(wasRaw ?? false); stdin.removeListener('data', onData); console.log(`\n${c.yellow}Отменено.${c.reset}`); process.exit(1); }
      else if (k.charCodeAt(0) >= 32) { val += k; process.stdout.write('*'); }
    };
    stdin.on('data', onData);
  });
}

const PROVIDERS = [
  { key: 'openai', label: 'OpenAI / совместимое API (облачные провайдеры)' },
  { key: 'opencode', label: 'OpenCode CLI (бесплатные модели, без API-ключа)' },
  { key: 'mock', label: 'Заглушка — без ИИ (только для тестирования)' },
];

async function main() {
  console.log(`\n${c.bold}${c.magenta}╔══════════════════════════════════════════╗${c.reset}`);
  console.log(`${c.bold}${c.magenta}║     Настройка окружения DocxGen         ║${c.reset}`);
  console.log(`${c.bold}${c.magenta}╚══════════════════════════════════════════╝${c.reset}\n`);
  console.log(`Создаёт файл ${c.bold}.env${c.reset}. Можно запустить снова для обновления.\n`);

  if (fs.existsSync(ENV_PATH)) {
    const rl0 = createRL();
    const ow = await askYesNo(rl0, 'Найден существующий .env. Перезаписать?', false);
    rl0.close();
    if (!ow) { console.log(`${c.yellow}Оставляю существующий .env.${c.reset}`); process.exit(0); }
  }

  const rl = createRL();
  const e = {};
  e.PORT = await ask(rl, 'Порт сервера', '3000');
  e.PUBLIC_URL = await ask(rl, 'Публичный URL', 'http://localhost:3000');
  e.DATA_DIR = await ask(rl, 'Директория данных', './data');
  e.LOG_LEVEL = await ask(rl, 'Уровень логов (info/debug)', 'info');
  e.DEBUG_COMMANDS = (await askYesNo(rl, 'Включить отладочные команды?', true)) ? '1' : '0';

  console.log(`\n${c.bold}ИИ-провайдер${c.reset}`);
  PROVIDERS.forEach((p, i) => console.log(`  ${c.cyan}${i + 1}${c.reset}) ${p.label}`));
  let choice = '';
  while (!['1', '2', '3'].includes(choice)) choice = await ask(rl, 'Выберите (1/2/3)', '2');
  const provider = PROVIDERS[parseInt(choice) - 1].key;
  e.AI_PROVIDER = provider;
  e.AI_TIMEOUT_MS = await ask(rl, 'Тайм-аут ИИ (мс)', '180000');

  if (provider === 'openai') {
    console.log(`\n${c.dim}Настройка OpenAI-совместимого провайдера:${c.reset}`);
    e.AI_API_KEY = await askSecret(rl, 'API-ключ (обязательный)');
    if (!e.AI_API_KEY) { console.log(`${c.red}API-ключ обязателен.${c.reset}`); process.exit(1); }
    e.AI_BASE_URL = await ask(rl, 'Базовый URL', 'https://api.openai.com/v1');
    e.AI_MODEL = await ask(rl, 'Модель', 'gpt-4o');
    e.OPENCODE_RUNTIME = 'local'; e.OPENCODE_BIN = 'opencode'; e.OPENCODE_IMAGE = 'doc3steps-opencode';
    e.OPENCODE_MODEL = ''; e.OPENCODE_AGENT = 'doc-editor'; e.OPENCODE_MAX_PARALLEL = '1';
  } else if (provider === 'opencode') {
    console.log(`\n${c.dim}Настройка OpenCode CLI:${c.reset}`);
    e.AI_API_KEY = ''; e.AI_BASE_URL = ''; e.AI_MODEL = '';
    e.OPENCODE_RUNTIME = await ask(rl, 'Среда выполнения (local/docker/podman)', 'local');
    e.OPENCODE_BIN = 'opencode'; e.OPENCODE_IMAGE = 'doc3steps-opencode';
    e.OPENCODE_MODEL = await ask(rl, 'Модель (пусто = по умолчанию)', '');
    e.OPENCODE_AGENT = await ask(rl, 'Агент', 'doc-editor');
    e.OPENCODE_MAX_PARALLEL = await ask(rl, 'Макс. параллельных запросов', '1');
  } else {
    e.AI_API_KEY = ''; e.AI_BASE_URL = ''; e.AI_MODEL = '';
    e.OPENCODE_RUNTIME = 'local'; e.OPENCODE_BIN = 'opencode'; e.OPENCODE_IMAGE = 'doc3steps-opencode';
    e.OPENCODE_MODEL = ''; e.OPENCODE_AGENT = 'doc-editor'; e.OPENCODE_MAX_PARALLEL = '1';
  }

  e.AI_FAULT = (await askYesNo(rl, 'Включить имитацию сбоев ИИ для тестирования?', false)) ? 'on' : 'off';

  console.log(`\n${c.bold}Интеграции (необязательно)${c.reset}`);
  e.MAX_ENABLED = (await askYesNo(rl, 'Включить бот MAX?', false)) ? '1' : '0';
  e.MAX_TOKEN = e.MAX_ENABLED === '1' ? await ask(rl, 'Токен MAX', '') : '';
  e.MAX_API_URL = 'https://platform-api2.max.ru'; e.MAX_MODE = 'polling';
  e.MAX_WEBHOOK_SECRET = ''; e.MAX_CA_FILE = 'certs/russian_trusted_root_ca.pem';
  e.VK_ENABLED = (await askYesNo(rl, 'Включить бот VK?', false)) ? '1' : '0';
  e.VK_GROUP_ID = e.VK_ENABLED === '1' ? await ask(rl, 'ID группы VK', '') : '';
  e.VK_TOKEN = e.VK_ENABLED === '1' ? await askSecret(rl, 'Токен VK') : '';
  e.VK_API_VERSION = '5.199'; e.VK_MODE = 'longpoll';
  e.VK_CALLBACK_SECRET = ''; e.VK_CONFIRMATION_CODE = '';
  e.CLEANUP_ENABLED = '1'; e.CLEANUP_INTERVAL_MS = '3600000';
  e.CLEANUP_FILE_MAX_AGE_HOURS = '24'; e.CLEANUP_LOG_MAX_AGE_DAYS = '30';
  e.AUDIO_SERVICE_PORT = '3005'; e.VOSK_MODEL_PATH = './models/vosk-model-small-ru-0.22';
  e.FFMPEG_BIN = 'ffmpeg'; e.VOSK_PYTHON = ''; e.API_KEY = '';
  rl.close();

  const lines = [
    '# ---------- Сервер ----------',
    `PORT=${e.PORT}`, `PUBLIC_URL=${e.PUBLIC_URL}`, `DATA_DIR=${e.DATA_DIR}`,
    `AUDIO_SERVICE_PORT=${e.AUDIO_SERVICE_PORT}`, `VOSK_MODEL_PATH=${e.VOSK_MODEL_PATH}`,
    `FFMPEG_BIN=${e.FFMPEG_BIN}`, `VOSK_PYTHON=${e.VOSK_PYTHON}`,
    `LOG_LEVEL=${e.LOG_LEVEL}`, `DEBUG_COMMANDS=${e.DEBUG_COMMANDS}`, '',
    '# ---------- ИИ ----------',
    `AI_PROVIDER=${e.AI_PROVIDER}`, `AI_TIMEOUT_MS=${e.AI_TIMEOUT_MS}`, `AI_FAULT=${e.AI_FAULT}`, '',
    `OPENCODE_RUNTIME=${e.OPENCODE_RUNTIME}`, `OPENCODE_BIN=${e.OPENCODE_BIN}`,
    `OPENCODE_IMAGE=${e.OPENCODE_IMAGE}`, `OPENCODE_MODEL=${e.OPENCODE_MODEL}`,
    `OPENCODE_AGENT=${e.OPENCODE_AGENT}`, `OPENCODE_MAX_PARALLEL=${e.OPENCODE_MAX_PARALLEL}`, '',
    `AI_BASE_URL=${e.AI_BASE_URL}`, `AI_API_KEY=${e.AI_API_KEY}`, `AI_MODEL=${e.AI_MODEL}`, '',
    '# ---------- MAX ----------',
    `MAX_ENABLED=${e.MAX_ENABLED}`, `MAX_TOKEN=${e.MAX_TOKEN}`, `MAX_API_URL=${e.MAX_API_URL}`,
    `MAX_MODE=${e.MAX_MODE}`, `MAX_WEBHOOK_SECRET=${e.MAX_WEBHOOK_SECRET}`, `MAX_CA_FILE=${e.MAX_CA_FILE}`, '',
    '# ---------- ВК ----------',
    `VK_ENABLED=${e.VK_ENABLED}`, `VK_GROUP_ID=${e.VK_GROUP_ID}`, `VK_TOKEN=${e.VK_TOKEN}`,
    `VK_API_VERSION=${e.VK_API_VERSION}`, `VK_MODE=${e.VK_MODE}`,
    `VK_CALLBACK_SECRET=${e.VK_CALLBACK_SECRET}`, `VK_CONFIRMATION_CODE=${e.VK_CONFIRMATION_CODE}`, '',
    '# ---------- Очистка ----------',
    `CLEANUP_ENABLED=${e.CLEANUP_ENABLED}`, `CLEANUP_INTERVAL_MS=${e.CLEANUP_INTERVAL_MS}`,
    `CLEANUP_FILE_MAX_AGE_HOURS=${e.CLEANUP_FILE_MAX_AGE_HOURS}`, `CLEANUP_LOG_MAX_AGE_DAYS=${e.CLEANUP_LOG_MAX_AGE_DAYS}`, '',
    '# ---------- Ключ для внешних интеграций ----------',
    `API_KEY=${e.API_KEY}`, '',
  ];
  fs.writeFileSync(ENV_PATH, lines.join('\n'), 'utf-8');

  console.log(`\n${c.bold}${c.green}✅ .env успешно создан!${c.reset}\n`);
  console.log(`${c.bold}Сводка конфигурации:${c.reset}`);
  console.log(`  ИИ-провайдер : ${c.cyan}${e.AI_PROVIDER}${c.reset}`);
  if (e.AI_PROVIDER === 'openai') { console.log(`  Базовый URL  : ${e.AI_BASE_URL}`); console.log(`  Модель       : ${e.AI_MODEL}`); }
  else if (e.AI_PROVIDER === 'opencode') { console.log(`  Среда        : ${e.OPENCODE_RUNTIME}`); console.log(`  Агент        : ${e.OPENCODE_AGENT}`); console.log(`  Параллельность: ${e.OPENCODE_MAX_PARALLEL}`); }
  console.log(`  Бот MAX      : ${e.MAX_ENABLED === '1' ? 'включён' : 'выключен'}`);
  console.log(`  Бот VK       : ${e.VK_ENABLED === '1' ? 'включён' : 'выключен'}`);
  console.log(`\n${c.bold}Следующие шаги:${c.reset}`);
  console.log(`  Запустите ${c.cyan}pnpm dev${c.reset} для старта сервера\n`);
}

main().catch((err) => {
  if (err.code === 'SIGINT' || err.message === 'readline was closed') { console.log(`\n${c.yellow}Отменено.${c.reset}`); }
  else { console.error(`${c.red}Ошибка:${c.reset}`, err.message); }
  process.exit(1);
});
