import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { toInboundEvents } from '../../src/adapters/max/normalize.js';
import { toInboundEvent } from '../../src/adapters/vk/normalize.js';

const fixture = (name) => JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../fixtures/max', name), 'utf8'));

describe('MAX messages without text', () => {
  it('skips a message the Bot API delivers without content (a voice message) instead of a chat «undefined»', () => {
    // Настоящий update: голосовое сообщение MAX приходит боту без поля message — ни чата, ни отправителя.
    expect(toInboundEvents(fixture('voice-message-created.json'))).toEqual([]);
  });

  it('treats an audio file as a voice draft', () => {
    const file = { type: 'file', payload: { url: 'https://files.max.test/a', token: 't' }, filename: 'Запись 12.m4a', size: 48213 };
    const [event] = toInboundEvents({ update_type: 'message_created', message: { body: { mid: 'm3', text: '', attachments: [file] }, recipient: { chat_id: 3, chat_type: 'dialog' }, sender: { user_id: 8 } } });
    expect(event).toMatchObject({ platform: 'max', kind: 'audio', audio: file, peerId: '3', userId: '8' });
  });

  it('does not take a document for an audio file', () => {
    const file = { type: 'file', payload: { url: 'https://files.max.test/b', token: 't' }, filename: 'договор.pdf', size: 1024 };
    const [event] = toInboundEvents({ update_type: 'message_created', message: { body: { mid: 'm4', text: '', attachments: [file] }, recipient: { chat_id: 3, chat_type: 'dialog' }, sender: { user_id: 8 } } });
    expect(event.kind).toBe('text');
  });
});

describe('normalizers', () => {
  it('normalizes MAX text and ignores groups', () => { expect(toInboundEvents({ update_type: 'message_created', message: { body: { mid: 'm1', text: 'Привет' }, recipient: { chat_id: 3, chat_type: 'dialog' }, sender: { user_id: 8 } } })[0]).toMatchObject({ platform: 'max', kind: 'text', peerId: '3', text: 'Привет' }); expect(toInboundEvents({ update_type: 'message_created', message: { body: { mid: 'm2', text: 'x' }, recipient: { chat_id: 3, chat_type: 'chat' }, sender: { user_id: 8 } } })).toEqual([]); });
  it('normalizes VK private message and ignores conversations', () => { expect(toInboundEvent({ type: 'message_new', event_id: 'e1', group_id: 1, object: { message: { peer_id: 9, from_id: 8, text: '/start', id: 1 } } })).toMatchObject({ platform: 'vk', kind: 'command', command: 'start' }); expect(toInboundEvent({ type: 'message_new', object: { message: { peer_id: 2000000001, from_id: 8, text: 'x' } } })).toBeNull(); });
});
