import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BOT_IMAGES_DIR, createBotImages } from '../../src/adapters/common/botImages.js';

let dir;
afterEach(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); dir = null; });

describe('bot images', () => {
  it('ships a PNG for every illustration the flow sends', () => {
    for (const name of ['greeting', 'types', 'templates', 'ready', 'ai-error']) {
      const file = path.join(BOT_IMAGES_DIR, `${name}.png`);
      expect(fs.existsSync(file), file).toBe(true);
      const png = fs.readFileSync(file);
      // PNG signature
      expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      // 16:9 — MAX shows images in a 16:9 frame and crops wider pictures at the sides
      expect([png.readUInt32BE(16), png.readUInt32BE(20)], name).toEqual([1280, 720]);
    }
  });

  it('loads an image with a content-addressed cache key', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-images-'));
    fs.writeFileSync(path.join(dir, 'greeting.png'), 'v1');
    const images = createBotImages({ dir });

    const first = await images.load('greeting');
    expect(first).toMatchObject({ filename: 'greeting.png' });
    expect(first.buffer.toString()).toBe('v1');
    expect(first.cacheKey).toMatch(/^greeting@[0-9a-f]{12}$/);

    // A redrawn picture must not reuse the token uploaded for the old one
    fs.writeFileSync(path.join(dir, 'greeting.png'), 'v2');
    expect((await images.load('greeting')).cacheKey).not.toBe(first.cacheKey);
  });

  it('returns null for missing files and unsafe names', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-images-'));
    const images = createBotImages({ dir });
    expect(await images.load('nope')).toBeNull();
    expect(await images.load('../secret')).toBeNull();
  });
});
