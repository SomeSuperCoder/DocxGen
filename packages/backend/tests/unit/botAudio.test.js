/**
 * Голосовые сообщения в ботах: ссылка из вложения MAX/ВК → скачивание → аудиосервис (Vosk).
 */
import { describe, expect, it } from 'vitest';
import { audioUrlOf, createBotTranscriber } from '../../src/audio/botAudio.js';
import { defaultVoskPython } from '../../src/config/env.js';

describe('audio attachment url', () => {
  it('reads the MAX audio payload url', () => {
    expect(audioUrlOf({ type: 'audio', payload: { url: 'https://max.test/voice.ogg', token: 't' } })).toBe('https://max.test/voice.ogg');
  });

  it('prefers the VK ogg link of an audio message', () => {
    expect(audioUrlOf({ type: 'audio_message', audio_message: { link_ogg: 'https://vk.test/a.ogg', link_mp3: 'https://vk.test/a.mp3' } })).toBe('https://vk.test/a.ogg');
    expect(audioUrlOf({ type: 'audio_message', audio_message: { link_mp3: 'https://vk.test/a.mp3' } })).toBe('https://vk.test/a.mp3');
  });

  it('returns null for attachments without a link', () => {
    expect(audioUrlOf({ type: 'audio', payload: {} })).toBeNull();
    expect(audioUrlOf(null)).toBeNull();
  });
});

describe('bot transcriber', () => {
  const voice = Buffer.from('OggS-voice-bytes');

  function fakeFetch({ transcribe = { status: 200, body: { ok: true, text: 'прошу выделить ноутбук' } } } = {}) {
    const calls = [];
    const impl = async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).startsWith('https://cdn.test/')) return new Response(voice, { status: 200 });
      const form = options.body;
      const file = form?.get?.('file');
      calls.at(-1).file = file ? Buffer.from(await file.arrayBuffer()) : null;
      return new Response(JSON.stringify(transcribe.body), { status: transcribe.status, headers: { 'content-type': 'application/json' } });
    };
    return { impl, calls };
  }

  it('downloads the voice message and sends it to the audio service as the owner', async () => {
    const { impl, calls } = fakeFetch();
    const transcribe = createBotTranscriber({ serviceUrl: 'http://127.0.0.1:3005', apiKey: 'k', fetchImpl: impl });

    const result = await transcribe({ type: 'audio', payload: { url: 'https://cdn.test/voice.ogg' } }, { platform: 'max', ownerId: '42' });

    expect(result.text).toBe('прошу выделить ноутбук');
    const post = calls.find((call) => call.url === 'http://127.0.0.1:3005/api/audio/transcribe');
    expect(post.options.method).toBe('POST');
    expect(post.options.headers).toMatchObject({ 'X-Owner-Platform': 'max', 'X-Owner-Id': '42', 'X-Api-Key': 'k' });
    expect(post.file.equals(voice)).toBe(true);
  });

  it('uses an already attached buffer without downloading', async () => {
    const { impl, calls } = fakeFetch();
    const transcribe = createBotTranscriber({ serviceUrl: 'http://127.0.0.1:3005', fetchImpl: impl });

    await transcribe({ buffer: voice }, { platform: 'vk', ownerId: '7' });

    expect(calls.map((call) => call.url)).toEqual(['http://127.0.0.1:3005/api/audio/transcribe']);
  });

  it('surfaces the audio service error message', async () => {
    const { impl } = fakeFetch({ transcribe: { status: 502, body: { error: { code: 'STT_FAILED', message: 'Речь не распознана' } } } });
    const transcribe = createBotTranscriber({ serviceUrl: 'http://127.0.0.1:3005', fetchImpl: impl });

    await expect(transcribe({ type: 'audio', payload: { url: 'https://cdn.test/voice.ogg' } }, { platform: 'max', ownerId: '1' }))
      .rejects.toMatchObject({ code: 'STT_FAILED', message: 'Речь не распознана' });
  });

  it('rejects voice messages larger than the limit', async () => {
    const { impl } = fakeFetch();
    const transcribe = createBotTranscriber({ serviceUrl: 'http://127.0.0.1:3005', maxBytes: 4, fetchImpl: impl });

    await expect(transcribe({ type: 'audio', payload: { url: 'https://cdn.test/voice.ogg' } }, { platform: 'max', ownerId: '1' }))
      .rejects.toMatchObject({ code: 'AUDIO_INVALID' });
  });

  it('rejects attachments without a link', async () => {
    const transcribe = createBotTranscriber({ serviceUrl: 'http://127.0.0.1:3005', fetchImpl: async () => { throw new Error('no network'); } });
    await expect(transcribe({ type: 'audio', payload: {} }, { platform: 'max', ownerId: '1' })).rejects.toMatchObject({ code: 'AUDIO_INVALID' });
  });
});

describe('Vosk python default', () => {
  it('points at the venv interpreter of the current OS', () => {
    expect(defaultVoskPython('win32')).toBe('./.venv-audio/Scripts/python.exe');
    expect(defaultVoskPython('linux')).toBe('./.venv-audio/bin/python');
    expect(defaultVoskPython('darwin')).toBe('./.venv-audio/bin/python');
  });
});
