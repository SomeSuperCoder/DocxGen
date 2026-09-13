/**
 * Декодирование аудио для Vosk: ffmpeg → PCM 16 кГц, моно, s16le.
 * Тесты запускают настоящий ffmpeg и пропускаются, если его нет в PATH.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVoskTranscriber, decodeAudio } from '../../src/audio/transcriber.js';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

/** Тон в контейнере MP4: ffmpeg по умолчанию пишет индекс (moov) в конец файла — как диктофоны и iPhone. */
function toneM4a(dir, seconds) {
  const file = path.join(dir, `tone-${seconds}s.m4a`);
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`, '-b:a', '128k', file]);
  if (result.status !== 0) throw new Error(result.stderr.toString());
  return fs.readFileSync(file);
}

describe.skipIf(!hasFfmpeg)('decodeAudio', () => {
  let dir;
  let tmpDir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'decode-src-'));
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decode-tmp-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('decodes a long m4a whose index is at the end of the file', async () => {
    const pcm = await decodeAudio(toneM4a(dir, 120), { tmpDir });
    // 16 000 Гц × 2 байта × 120 с; кодек AAC добавляет несколько десятков миллисекунд
    expect(pcm.length / 32000).toBeGreaterThan(119.9);
    expect(pcm.length / 32000).toBeLessThan(120.2);
  });

  it('rejects unreadable input with a readable message and keeps the ffmpeg output as detail', async () => {
    const error = await decodeAudio(Buffer.from('это не аудио, а текст'), { tmpDir }).catch((err) => err);
    expect(error.code).toBe('AUDIO_INVALID');
    expect(error.message).toBe('Не удалось прочитать аудиофайл. Запишите сообщение ещё раз или выберите другой файл.');
    expect(error.detail).toMatch(/Invalid data|could not find|error/i);
  });

  it('removes the temporary file after success and after failure', async () => {
    await decodeAudio(toneM4a(dir, 1), { tmpDir });
    await decodeAudio(Buffer.from('мусор'), { tmpDir }).catch(() => {});
    expect(fs.readdirSync(tmpDir)).toEqual([]);
  });
});

/** WAV 16 кГц, моно, 16 бит с тишиной — минимальный файл, который читает ffmpeg. */
function silentWav(seconds = 0.5) {
  const data = Buffer.alloc(Math.round(16000 * seconds) * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** Зависший промис превращается в понятную ошибку теста вместо общего таймаута vitest. */
function within(ms, promise) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`no answer in ${ms} ms`)), ms))]);
}

describe.skipIf(!hasFfmpeg)('Vosk sidecar', () => {
  let modelDir;
  let transcriber;
  beforeEach(() => { modelDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vosk-model-')); });
  afterEach(() => {
    transcriber?.close();
    fs.rmSync(modelDir, { recursive: true, force: true });
  });

  it('starts the sidecar again when it has exited, so later requests are answered', async () => {
    transcriber = await createVoskTranscriber({
      modelPath: modelDir,
      python: process.execPath,
      script: path.resolve(import.meta.dirname, '../fixtures/audio/sidecar-one-reply.mjs'),
    });

    await expect(within(5000, transcriber.transcribe(silentWav()))).resolves.toMatchObject({ text: 'прошу выделить ноутбук' });
    await expect(within(5000, transcriber.transcribe(silentWav()))).resolves.toMatchObject({ text: 'прошу выделить ноутбук' });
  });
});

const python = ['python3', 'python'].find((bin) => spawnSync(bin, ['--version']).status === 0);

describe.skipIf(!hasFfmpeg || !python)('Vosk sidecar script (transcriber.py)', () => {
  let modelDir;
  let transcriber;
  beforeEach(() => { modelDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vosk-model-')); });
  afterEach(() => {
    transcriber?.close();
    vi.unstubAllEnvs();
    fs.rmSync(modelDir, { recursive: true, force: true });
  });

  it('returns Russian text when the pipe encoding cannot represent Cyrillic (Windows cp1252)', async () => {
    // Настоящий transcriber.py с подменённым пакетом vosk; cp1252 — кодировка pipe у Python на Windows.
    vi.stubEnv('PYTHONPATH', path.resolve(import.meta.dirname, '../fixtures/audio/fake-vosk'));
    vi.stubEnv('PYTHONIOENCODING', 'cp1252');
    transcriber = await createVoskTranscriber({ modelPath: modelDir, python });

    await expect(within(8000, transcriber.transcribe(silentWav()))).resolves.toMatchObject({ text: 'прошу выделить ноутбук' });
  });
});
