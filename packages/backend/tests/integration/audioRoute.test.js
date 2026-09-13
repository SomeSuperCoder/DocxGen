/**
 * Микрофон сайта: браузер → backend (/api/audio/transcribe, владелец из cookie) → аудиосервис.
 * Аудиосервис настоящий (HTTP на свободном порту), подменён только распознаватель Vosk.
 */
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import pino from 'pino';
import { createApp } from '../../src/app.js';
import { createAudioServiceApp } from '../../src/audio-service.js';
import { createAudioClient } from '../../src/audio/audioClient.js';
import { DomainError } from '../../src/core/errors.js';

const silentLog = pino({ level: 'silent' });
const recording = Buffer.from('webm-opus-recording-bytes');

const servers = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

/** Аудиосервис с подменённым распознавателем; возвращает его адрес и полученные файлы. */
async function startAudioService(transcribe) {
  const received = [];
  const transcriber = { transcribe: async (file) => { received.push(file); return transcribe(file); } };
  const server = createAudioServiceApp({ transcriber, apiKey: 'service-key', logger: silentLog }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  servers.push(server);
  return { url: `http://127.0.0.1:${server.address().port}`, received };
}

function backendFor(serviceUrl) {
  const audioClient = createAudioClient({ serviceUrl, apiKey: 'service-key' });
  return createApp({ log: silentLog, deps: { apiKey: 'service-key', audioClient } });
}

describe('POST /api/audio/transcribe', () => {
  it('sends the recording of a web session to the audio service and returns the text', async () => {
    const service = await startAudioService(async () => ({ text: 'прошу выделить ноутбук', duration: 1.5 }));

    const res = await request(backendFor(service.url))
      .post('/api/audio/transcribe')
      .attach('file', recording, { filename: 'recording.webm', contentType: 'audio/webm' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, text: 'прошу выделить ноутбук', duration: 1.5 });
    expect(service.received).toHaveLength(1);
    expect(service.received[0].equals(recording)).toBe(true);
  });

  it('passes the recognition error to the browser with its code and message', async () => {
    const service = await startAudioService(async () => { throw DomainError.STT_FAILED('Речь не распознана'); });

    const res = await request(backendFor(service.url))
      .post('/api/audio/transcribe')
      .attach('file', recording, 'recording.webm');

    expect(res.status).toBe(502);
    expect(res.body.error).toEqual({ code: 'STT_FAILED', message: 'Речь не распознана' });
  });

  it('answers 503 with a readable message when the audio service is not running', async () => {
    const service = await startAudioService(async () => ({ text: 'x', duration: 1 }));
    await new Promise((resolve) => servers.pop().close(resolve));

    const res = await request(backendFor(service.url))
      .post('/api/audio/transcribe')
      .attach('file', recording, 'recording.webm');

    expect(res.status).toBe(503);
    expect(res.body.error).toEqual({ code: 'STT_UNAVAILABLE', message: 'Сервис распознавания речи недоступен. Попробуйте позже.' });
  });

  it('rejects a request without an audio file before calling the audio service', async () => {
    const service = await startAudioService(async () => ({ text: 'x', duration: 1 }));

    const res = await request(backendFor(service.url))
      .post('/api/audio/transcribe')
      .field('note', 'без файла');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('AUDIO_INVALID');
    expect(service.received).toHaveLength(0);
  });
});
