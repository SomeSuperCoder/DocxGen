import { describe, it, expect } from 'vitest';
import { parseRichText } from '../../src/docx/richText.js';

function getText(run) {
  return run.root[1].root[1];
}

function hasFormatting(run, key) {
  return run.root[0].root.some((n) => n.rootKey === key);
}

describe('parseRichText', () => {
  it('returns empty array for null input', () => {
    expect(parseRichText(null)).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(parseRichText('')).toEqual([]);
  });

  it('returns single TextRun for plain text with no tags', () => {
    const runs = parseRichText('hello');
    expect(runs).toHaveLength(1);
    expect(getText(runs[0])).toBe('hello');
    expect(runs[0].root[0].root).toHaveLength(0);
  });

  it('handles <b> tag as bold', () => {
    const runs = parseRichText('<b>bold</b>');
    expect(runs).toHaveLength(1);
    expect(getText(runs[0])).toBe('bold');
    expect(hasFormatting(runs[0], 'w:b')).toBe(true);
  });

  it('handles <strong> tag as bold', () => {
    const runs = parseRichText('<strong>strong</strong>');
    expect(runs).toHaveLength(1);
    expect(getText(runs[0])).toBe('strong');
    expect(hasFormatting(runs[0], 'w:b')).toBe(true);
  });

  it('handles <i> tag as italics', () => {
    const runs = parseRichText('<i>italic</i>');
    expect(runs).toHaveLength(1);
    expect(getText(runs[0])).toBe('italic');
    expect(hasFormatting(runs[0], 'w:i')).toBe(true);
  });

  it('handles <em> tag as italics', () => {
    const runs = parseRichText('<em>emphasized</em>');
    expect(runs).toHaveLength(1);
    expect(getText(runs[0])).toBe('emphasized');
    expect(hasFormatting(runs[0], 'w:i')).toBe(true);
  });

  it('handles <u> tag as underline', () => {
    const runs = parseRichText('<u>underlined</u>');
    expect(runs).toHaveLength(1);
    expect(getText(runs[0])).toBe('underlined');
    expect(hasFormatting(runs[0], 'w:u')).toBe(true);
  });

  it('handles nested <b><i> as bold + italics in single run', () => {
    const runs = parseRichText('<b><i>both</i></b>');
    expect(runs).toHaveLength(1);
    expect(getText(runs[0])).toBe('both');
    expect(hasFormatting(runs[0], 'w:b')).toBe(true);
    expect(hasFormatting(runs[0], 'w:i')).toBe(true);
  });

  it('handles adjacent tags as separate TextRuns (space becomes its own run)', () => {
    const runs = parseRichText('<b>bold</b> <i>italic</i>');
    expect(runs).toHaveLength(3);
    expect(getText(runs[0])).toBe('bold');
    expect(hasFormatting(runs[0], 'w:b')).toBe(true);
    expect(getText(runs[1])).toBe(' ');
    expect(runs[1].root[0].root).toHaveLength(0);
    expect(getText(runs[2])).toBe('italic');
    expect(hasFormatting(runs[2], 'w:i')).toBe(true);
  });

  it('handles nested with text after inner close', () => {
    const runs = parseRichText('<b><i>inner</i> outer</b>');
    expect(runs).toHaveLength(2);
    expect(getText(runs[0])).toBe('inner');
    expect(hasFormatting(runs[0], 'w:b')).toBe(true);
    expect(hasFormatting(runs[0], 'w:i')).toBe(true);
    expect(getText(runs[1])).toBe(' outer');
    expect(hasFormatting(runs[1], 'w:b')).toBe(true);
    expect(hasFormatting(runs[1], 'w:i')).toBe(false);
  });

  it('treats unknown tags as literal text', () => {
    const runs = parseRichText('<x>text</x>');
    expect(runs).toHaveLength(1);
    expect(getText(runs[0])).toBe('<x>text</x>');
    expect(runs[0].root[0].root).toHaveLength(0);
  });

  it('handles mixed known and unknown tags', () => {
    const runs = parseRichText('<b>bold</b> <x>text</x>');
    expect(runs).toHaveLength(2);
    expect(getText(runs[0])).toBe('bold');
    expect(hasFormatting(runs[0], 'w:b')).toBe(true);
    expect(getText(runs[1])).toBe(' <x>text</x>');
    expect(runs[1].root[0].root).toHaveLength(0);
  });

  it('is case insensitive for tag names', () => {
    const runsBold = parseRichText('<B>text</B>');
    expect(runsBold).toHaveLength(1);
    expect(getText(runsBold[0])).toBe('text');
    expect(hasFormatting(runsBold[0], 'w:b')).toBe(true);

    const runsItalic = parseRichText('<I>text</I>');
    expect(runsItalic).toHaveLength(1);
    expect(getText(runsItalic[0])).toBe('text');
    expect(hasFormatting(runsItalic[0], 'w:i')).toBe(true);
  });

  it('filters out empty TextRuns from empty tags', () => {
    const runs = parseRichText('<b></b>text');
    expect(runs).toHaveLength(1);
    expect(getText(runs[0])).toBe('text');
  });

  it('handles three levels of nesting (bold + italic + underline)', () => {
    const runs = parseRichText('<b><i><u>all three</u></i></b>');
    expect(runs).toHaveLength(1);
    expect(getText(runs[0])).toBe('all three');
    expect(hasFormatting(runs[0], 'w:b')).toBe(true);
    expect(hasFormatting(runs[0], 'w:i')).toBe(true);
    expect(hasFormatting(runs[0], 'w:u')).toBe(true);
  });
});
