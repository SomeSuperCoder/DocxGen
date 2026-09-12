/**
 * Рендер иллюстраций бота: assets/bot/src/*.svg → assets/bot/*.png (1280×720, 16:9).
 *
 * SVG вставляется в HTML-страницу со шрифтом Golos Text из фронтенда и снимается
 * headless-браузером (Edge/Chrome — ничего скачивать не нужно).
 *
 *   pnpm --filter @docxgen/backend bot:images            # все картинки
 *   pnpm --filter @docxgen/backend bot:images greeting   # только одну
 *
 * Путь к браузеру можно задать переменной BROWSER.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'assets/bot/src');
const OUT = path.join(ROOT, 'assets/bot');
const FRONTEND = path.resolve(ROOT, '../frontend');
const WIDTH = 1280;
const HEIGHT = 720;

const browser = [
  process.env.BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((candidate) => candidate && fs.existsSync(candidate));
if (!browser) throw new Error('Не найден Edge/Chrome — укажите путь в переменной BROWSER');

// Те же @font-face, что у сайта (с unicode-range по подмножествам), но с file:// путями.
const fontsUrl = pathToFileURL(path.join(FRONTEND, 'public/fonts')).href;
const fontFaces = (fs.readFileSync(path.join(FRONTEND, 'src/index.css'), 'utf8').match(/@font-face\s*{[^}]*}/g) ?? [])
  .filter((block) => block.includes('Golos Text'))
  .map((block) => block.replaceAll('url(/fonts/', `url(${fontsUrl}/`))
  .join('\n');

const only = process.argv.slice(2);
const names = fs.readdirSync(SRC)
  .filter((file) => file.endsWith('.svg'))
  .map((file) => path.basename(file, '.svg'))
  .filter((name) => only.length === 0 || only.includes(name));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-images-'));
try {
  for (const name of names) {
    const svg = fs.readFileSync(path.join(SRC, `${name}.svg`), 'utf8');
    const page = path.join(tmp, `${name}.html`);
    fs.writeFileSync(page, `<!doctype html><meta charset="utf-8"><style>${fontFaces}
html,body{margin:0;width:${WIDTH}px;height:${HEIGHT}px;overflow:hidden}svg{display:block}</style>${svg}`);
    const out = path.join(OUT, `${name}.png`);
    execFileSync(browser, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
      `--user-data-dir=${path.join(tmp, 'profile')}`,
      '--force-device-scale-factor=1', `--window-size=${WIDTH},${HEIGHT}`,
      '--virtual-time-budget=3000', `--screenshot=${out}`, pathToFileURL(page).href,
    ], { stdio: 'ignore' });
    console.log(`${name}.png`);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
