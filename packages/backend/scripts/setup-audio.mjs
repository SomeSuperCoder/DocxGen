/**
 * Установка распознавания речи (Windows, Linux, macOS):
 * venv .venv-audio с пакетом vosk + модель vosk-model-small-ru-0.22 в models/.
 *
 *   cd packages/backend && npm run setup:audio
 *
 * Python для создания venv — переменная SETUP_PYTHON (по умолчанию python на Windows, python3 на остальных).
 * ffmpeg должен быть в PATH (или в FFMPEG_BIN).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WINDOWS = process.platform === 'win32';
const VENV = path.join(ROOT, '.venv-audio');
const VENV_PYTHON = path.join(VENV, WINDOWS ? 'Scripts/python.exe' : 'bin/python');
const MODEL_NAME = 'vosk-model-small-ru-0.22';
const MODEL_DIR = path.join(ROOT, 'models', MODEL_NAME);
const MODEL_URL = `https://alphacephei.com/vosk/models/${MODEL_NAME}.zip`;

const fail = (message) => { console.error(`✗ ${message}`); process.exit(1); };
const run = (command, args, options = {}) => spawnSync(command, args, { stdio: 'inherit', ...options });
const works = (command, args) => spawnSync(command, args, { stdio: 'ignore' }).status === 0;

const python = process.env.SETUP_PYTHON || (WINDOWS ? 'python' : 'python3');
if (!works(python, ['--version'])) fail(`Не найден Python: ${python}. Установите Python 3 или укажите SETUP_PYTHON.`);

const ffmpeg = process.env.FFMPEG_BIN || 'ffmpeg';
if (!works(ffmpeg, ['-version'])) fail(`Не найден ffmpeg (${ffmpeg}). Windows: scoop install ffmpeg; Ubuntu: apt install ffmpeg; macOS: brew install ffmpeg.`);
console.log('✓ ffmpeg найден');

if (!fs.existsSync(VENV_PYTHON)) {
  console.log(`→ Создаю ${path.relative(ROOT, VENV)}`);
  if (run(python, ['-m', 'venv', VENV]).status !== 0) fail('Не удалось создать venv (на Ubuntu нужен пакет python3-venv).');
}
if (run(VENV_PYTHON, ['-m', 'pip', 'install', '--upgrade', 'pip', 'vosk']).status !== 0) fail('Не удалось установить пакет vosk.');
if (!works(VENV_PYTHON, ['-c', 'import vosk'])) fail('Пакет vosk установлен, но не импортируется.');
console.log('✓ vosk установлен');

if (!fs.existsSync(path.join(MODEL_DIR, 'am', 'final.mdl'))) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vosk-model-'));
  try {
    console.log(`→ Скачиваю модель ${MODEL_URL}`);
    const response = await fetch(MODEL_URL);
    if (!response.ok) fail(`Не удалось скачать модель: HTTP ${response.status}`);
    const zip = path.join(tmp, 'model.zip');
    fs.writeFileSync(zip, Buffer.from(await response.arrayBuffer()));
    fs.mkdirSync(path.join(ROOT, 'models'), { recursive: true });
    // zipfile из стандартной библиотеки Python — одинаково на всех ОС, без unzip/tar
    if (run(VENV_PYTHON, ['-m', 'zipfile', '-e', zip, path.join(ROOT, 'models')]).status !== 0) fail('Не удалось распаковать модель.');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
console.log(`✓ модель ${path.relative(ROOT, MODEL_DIR)}`);
console.log('Распознавание речи готово. Запуск из корня проекта: npm run dev');
