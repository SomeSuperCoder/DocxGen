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
      else if (k === '\u0003') { if (stdin.isTTY) stdin.setRawMode(wasRaw ?? false); stdin.removeListener('data', onData); console.log(`\n${c.yellow}Aborted.${c.reset}`); process.exit(1); }
      else if (k.charCodeAt(0) >= 32) { val += k; process.stdout.write('*'); }
    };
    stdin.on('data', onData);
  });
}

const PROVIDERS = [
  { key: 'openai', label: 'OpenAI / compatible API (cloud providers)' },
  { key: 'opencode', label: 'OpenCode CLI (free models, no API key)' },
  { key: 'mock', label: 'Mock — no AI (for testing only)' },
];

async function main() {
  console.log(`\n${c.bold}${c.magenta}╔══════════════════════════════════════════╗${c.reset}`);
  console.log(`${c.bold}${c.magenta}║       DocxGen Environment Setup         ║${c.reset}`);
  console.log(`${c.bold}${c.magenta}╚══════════════════════════════════════════╝${c.reset}\n`);
  console.log(`Creates a ${c.bold}.env${c.reset} file. Re-run anytime to update.\n`);

  if (fs.existsSync(ENV_PATH)) {
    const rl0 = createRL();
    const ow = await askYesNo(rl0, 'Found existing .env. Overwrite?', false);
    rl0.close();
    if (!ow) { console.log(`${c.yellow}Keeping existing .env.${c.reset}`); process.exit(0); }
  }

  const rl = createRL();
  const e = {};
  e.PORT = await ask(rl, 'Server port', '3000');
  e.PUBLIC_URL = await ask(rl, 'Public URL', 'http://localhost:3000');
  e.DATA_DIR = await ask(rl, 'Data directory', './data');
  e.LOG_LEVEL = await ask(rl, 'Log level (info/debug)', 'info');
  e.DEBUG_COMMANDS = (await askYesNo(rl, 'Enable debug commands?', true)) ? '1' : '0';

  console.log(`\n${c.bold}AI Provider${c.reset}`);
  PROVIDERS.forEach((p, i) => console.log(`  ${c.cyan}${i + 1}${c.reset}) ${p.label}`));
  let choice = '';
  while (!['1', '2', '3'].includes(choice)) choice = await ask(rl, 'Select (1/2/3)', '2');
  const provider = PROVIDERS[parseInt(choice) - 1].key;
  e.AI_PROVIDER = provider;
  e.AI_TIMEOUT_MS = await ask(rl, 'AI timeout (ms)', '180000');

  if (provider === 'openai') {
    console.log(`\n${c.dim}Configure OpenAI-compatible provider:${c.reset}`);
    e.AI_API_KEY = await askSecret(rl, 'API Key (required)');
    if (!e.AI_API_KEY) { console.log(`${c.red}API key required.${c.reset}`); process.exit(1); }
    e.AI_BASE_URL = await ask(rl, 'Base URL', 'https://api.openai.com/v1');
    e.AI_MODEL = await ask(rl, 'Model', 'gpt-4o');
    e.OPENCODE_RUNTIME = ''; e.OPENCODE_BIN = ''; e.OPENCODE_IMAGE = '';
    e.OPENCODE_MODEL = ''; e.OPENCODE_AGENT = ''; e.OPENCODE_MAX_PARALLEL = '';
  } else if (provider === 'opencode') {
    console.log(`\n${c.dim}Configure OpenCode CLI:${c.reset}`);
    e.AI_API_KEY = ''; e.AI_BASE_URL = ''; e.AI_MODEL = '';
    e.OPENCODE_RUNTIME = await ask(rl, 'Runtime (local/docker/podman)', 'local');
    e.OPENCODE_BIN = 'opencode'; e.OPENCODE_IMAGE = 'doc3steps-opencode';
    e.OPENCODE_MODEL = await ask(rl, 'Model (empty = default)', '');
    e.OPENCODE_AGENT = await ask(rl, 'Agent', 'doc-editor');
    e.OPENCODE_MAX_PARALLEL = await ask(rl, 'Max parallel requests', '1');
  } else {
    e.AI_API_KEY = ''; e.AI_BASE_URL = ''; e.AI_MODEL = '';
    e.OPENCODE_RUNTIME = ''; e.OPENCODE_BIN = ''; e.OPENCODE_IMAGE = '';
    e.OPENCODE_MODEL = ''; e.OPENCODE_AGENT = ''; e.OPENCODE_MAX_PARALLEL = '';
  }

  e.AI_FAULT = (await askYesNo(rl, 'Enable AI fault injection for testing?', false)) ? 'on' : 'off';

  console.log(`\n${c.bold}Integrations (optional)${c.reset}`);
  e.MAX_ENABLED = (await askYesNo(rl, 'Enable MAX bot?', false)) ? '1' : '0';
  e.MAX_TOKEN = e.MAX_ENABLED === '1' ? await ask(rl, 'MAX token', '') : '';
  e.MAX_API_URL = 'https://platform-api2.max.ru'; e.MAX_MODE = 'polling';
  e.MAX_WEBHOOK_SECRET = ''; e.MAX_CA_FILE = 'certs/russian_trusted_root_ca.pem';
  e.VK_ENABLED = (await askYesNo(rl, 'Enable VK bot?', false)) ? '1' : '0';
  e.VK_GROUP_ID = e.VK_ENABLED === '1' ? await ask(rl, 'VK group ID', '') : '';
  e.VK_TOKEN = e.VK_ENABLED === '1' ? await askSecret(rl, 'VK token') : '';
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

  console.log(`\n${c.bold}${c.green}✅ .env created successfully!${c.reset}\n`);
  console.log(`${c.bold}Configuration summary:${c.reset}`);
  console.log(`  AI Provider : ${c.cyan}${e.AI_PROVIDER}${c.reset}`);
  if (e.AI_PROVIDER === 'openai') { console.log(`  Base URL    : ${e.AI_BASE_URL}`); console.log(`  Model       : ${e.AI_MODEL}`); }
  else if (e.AI_PROVIDER === 'opencode') { console.log(`  Runtime     : ${e.OPENCODE_RUNTIME}`); console.log(`  Agent       : ${e.OPENCODE_AGENT}`); console.log(`  Max parallel: ${e.OPENCODE_MAX_PARALLEL}`); }
  console.log(`  MAX bot     : ${e.MAX_ENABLED === '1' ? 'enabled' : 'disabled'}`);
  console.log(`  VK bot      : ${e.VK_ENABLED === '1' ? 'enabled' : 'disabled'}`);
  console.log(`\n${c.bold}Next steps:${c.reset}`);
  console.log(`  Run ${c.cyan}pnpm dev${c.reset} to start the server\n`);
}

main().catch((err) => {
  if (err.code === 'SIGINT' || err.message === 'readline was closed') { console.log(`\n${c.yellow}Aborted.${c.reset}`); }
  else { console.error(`${c.red}Error:${c.reset}`, err.message); }
  process.exit(1);
});
