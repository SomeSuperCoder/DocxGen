import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DomainError } from '../core/errors.js';

/**
 * Convert any ffmpeg-supported input to the exact stream Vosk expects.
 * The input goes through a temporary file, not stdin: MP4/M4A (iPhone, Safari, phone recorders)
 * keep their index at the end of the file, and ffmpeg cannot seek back in a pipe.
 */
export async function decodeAudio(input, { ffmpeg = 'ffmpeg', maxBytes = 25 * 1024 * 1024, tmpDir = os.tmpdir() } = {}) {
  if (!Buffer.isBuffer(input) || input.length === 0 || input.length > maxBytes) {
    throw DomainError.AUDIO_INVALID('Аудиофайл пустой или слишком большой');
  }
  const file = path.join(tmpDir, `docxgen-audio-${crypto.randomUUID()}`);
  await fs.promises.writeFile(file, input);
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', file, '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1']);
      const chunks = [];
      let stderr = '';
      child.stdout.on('data', (chunk) => chunks.push(chunk));
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      child.once('error', (error) => reject(DomainError.STT_FAILED(`Не удалось запустить ffmpeg: ${error.message}`)));
      child.once('close', (code) => {
        if (code === 0 && chunks.length) return resolve(Buffer.concat(chunks));
        // The ffmpeg output is for the log: the user gets a message they can act on.
        const error = DomainError.AUDIO_INVALID('Не удалось прочитать аудиофайл. Запишите сообщение ещё раз или выберите другой файл.');
        error.detail = stderr.trim();
        reject(error);
      });
    });
  } finally {
    await fs.promises.rm(file, { force: true });
  }
}

/**
 * Vosk runs in an isolated Python environment; Node 24 cannot build ffi-napi.
 * The sidecar starts right away so the model is loaded before the first request. If it exits
 * (crash, killed process), its pending requests fail and the next request starts a new one —
 * otherwise every later request would wait for an answer from a process that no longer exists.
 */
export async function createVoskTranscriber({ modelPath, ffmpeg, maxBytes, python = 'python3', script = path.join(import.meta.dirname, 'transcriber.py') } = {}) {
  if (!fs.existsSync(modelPath)) throw DomainError.STT_FAILED(`Модель Vosk не найдена: ${modelPath}. Скачайте vosk-model-small-ru-0.22 и распакуйте её в этот каталог.`);

  function start() {
    const child = spawn(python, [script], { env: { ...process.env, VOSK_MODEL_PATH: modelPath } });
    const sidecar = { child, pending: [] };
    let stderr = '';
    let buffer = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.stdin.on('error', () => {}); // a write to an exited process; the exit handler rejects the request
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        const request = sidecar.pending.shift();
        if (!request) continue;
        try { const result = JSON.parse(line); result.error ? request.reject(DomainError.STT_FAILED(result.error)) : request.resolve(result); }
        catch { request.reject(DomainError.STT_FAILED('Vosk вернул некорректный ответ')); }
      }
    });
    const fail = (message) => {
      if (current === sidecar) current = null;
      while (sidecar.pending.length) sidecar.pending.shift().reject(DomainError.STT_FAILED(message));
    };
    child.once('error', (error) => fail(`Не удалось запустить Vosk: ${error.message}`));
    child.once('exit', (code) => fail(stderr.trim() || `Vosk завершился с кодом ${code}`));
    return sidecar;
  }

  let current = start();
  return {
    async transcribe(input) {
      const pcm = await decodeAudio(input, { ffmpeg, maxBytes });
      if (!current) current = start();
      const sidecar = current;
      const result = await new Promise((resolve, reject) => {
        sidecar.pending.push({ resolve, reject });
        sidecar.child.stdin.write(`${JSON.stringify({ pcm: pcm.toString('hex') })}\n`);
      });
      const text = String(result.text ?? '').trim();
      if (!text) throw DomainError.STT_FAILED('Речь не распознана');
      return { text, duration: Number((pcm.length / 32000).toFixed(2)) };
    },
    close() { current?.child.kill(); current = null; },
  };
}
