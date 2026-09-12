/**
 * Иллюстрации в MAX и ВК: форма ответов загрузки взята из реальных API
 * (MAX отдаёт photos как объект по id, ВК отвергает PNG, названный file0.jpg).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../../src/db/index.js';
import { createMaxAdapter } from '../../src/adapters/max/adapter.js';
import { createVkAdapter } from '../../src/adapters/vk/adapter.js';
import { createVkClient } from '../../src/adapters/vk/client.js';

const images = { load: async (name) => ({ buffer: Buffer.from(`png:${name}`), filename: `${name}.png`, cacheKey: `${name}@abc123` }) };
const files = { get: () => null };
const silentLog = () => ({ warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() });

let db;
afterEach(() => { db?.close(); db = null; });

describe('MAX images', () => {
  it('takes the image token from photos keyed by id and uploads each picture once', async () => {
    db = openDb(':memory:');
    const uploads = [];
    const sent = [];
    const client = {
      upload: async (type, buffer, filename, contentType) => {
        uploads.push({ type, filename, contentType });
        return { slot: { url: 'https://upload.max.test' }, uploaded: { photos: { 'jIB0DuJ5JGe+BDXe==': { token: 'image-token' } } } };
      },
      sendMessage: async (peerId, body) => { sent.push(body); },
    };
    const adapter = createMaxAdapter({ db, client, files, images, log: silentLog(), retryDelaysMs: [] });

    await adapter.send('chat-1', [{ text: '<b>Привет</b>', format: 'html', image: { name: 'greeting' } }], { event: {} });
    await adapter.send('chat-1', [{ text: 'Ещё раз', format: 'html', image: { name: 'greeting' } }], { event: {} });

    expect(uploads).toEqual([{ type: 'image', filename: 'greeting.png', contentType: 'image/png' }]);
    for (const body of sent) expect(body.attachments[0]).toEqual({ type: 'image', payload: { token: 'image-token' } });
  });

  it('warns and still sends the text when the upload returns no token', async () => {
    db = openDb(':memory:');
    const log = silentLog();
    const sent = [];
    const client = { upload: async () => ({ slot: { url: 'u' }, uploaded: {} }), sendMessage: async (peerId, body) => { sent.push(body); } };
    const adapter = createMaxAdapter({ db, client, files, images, log, retryDelaysMs: [] });

    await adapter.send('chat-1', [{ text: 'Привет', format: 'html', image: { name: 'greeting' } }], { event: {} });

    expect(sent).toHaveLength(1);
    expect(sent[0].attachments ?? []).not.toContainEqual(expect.objectContaining({ type: 'image' }));
    expect(log.warn).toHaveBeenCalled();
  });
});

describe('VK images', () => {
  it('uploads a PNG under its own filename and content type', async () => {
    const calls = [];
    const upload = { messagePhoto: async (params) => { calls.push(params); return 'photo-1_2_key'; } };
    const client = createVkClient({ api: {}, upload });

    await client.uploadPhoto('42', Buffer.from('png'), 'greeting.png');

    expect(calls[0]).toMatchObject({ peer_id: 42, source: { filename: 'greeting.png', contentType: 'image/png' } });
  });

  it('passes the asset filename to the upload and reuses the cached attachment', async () => {
    db = openDb(':memory:');
    const uploads = [];
    const sent = [];
    const client = {
      uploadPhoto: async (peerId, buffer, filename) => { uploads.push({ peerId, filename }); return 'photo-1_2_key'; },
      sendMessage: async (params) => { sent.push(params); },
      isRetryable: () => false,
    };
    const adapter = createVkAdapter({ db, client, files, images, log: silentLog(), retryDelaysMs: [] });

    await adapter.send('42', [{ text: 'Привет', format: 'html', image: { name: 'types' } }], { event: {} });
    await adapter.send('42', [{ text: 'Ещё раз', format: 'html', image: { name: 'types' } }], { event: {} });

    expect(uploads).toEqual([{ peerId: '42', filename: 'types.png' }]);
    expect(sent.map((params) => params.attachment)).toEqual(['photo-1_2_key', 'photo-1_2_key']);
  });
});
