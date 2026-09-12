import { TextRun, UnderlineType } from 'docx';

/**
 * Supported HTML tags for rich text formatting.
 * Opening tags set formatting ON, closing tags set it OFF.
 */
const TAG_MAP = {
  b: 'bold',
  strong: 'bold',
  i: 'italics',
  em: 'italics',
  u: 'underline',
};

/**
 * Allowed tag names as a Set for O(1) lookup.
 */
const ALLOWED_TAGS = new Set(Object.keys(TAG_MAP));

/**
 * Build a formatting state object from the active tags set.
 */
function makeFormatting(activeTags) {
  const fmt = {};
  if (activeTags.has('bold')) fmt.bold = true;
  if (activeTags.has('italics')) fmt.italics = true;
  if (activeTags.has('underline')) fmt.underline = { type: UnderlineType.SINGLE };
  return fmt;
}

/**
 * Try to parse an HTML tag starting at position `pos` in `text`.
 * Returns { length, isClosing, tagName } if a supported tag is found, or null.
 *
 * Supported tags: b, strong, i, em, u (case-insensitive).
 * Allows optional whitespace before the closing >.
 */
function tryParseTag(text, pos) {
  if (pos >= text.length || text[pos] !== '<') return null;

  // Check if this is a closing tag
  const isClosing = pos + 1 < text.length && text[pos + 1] === '/';
  const nameStart = isClosing ? pos + 2 : pos + 1;

  // Extract tag name characters (letters only)
  let nameEnd = nameStart;
  while (nameEnd < text.length && /[a-zA-Z]/.test(text[nameEnd])) {
    nameEnd++;
  }

  const rawName = text.slice(nameStart, nameEnd);
  if (!rawName) return null;

  const lowerName = rawName.toLowerCase();
  if (!ALLOWED_TAGS.has(lowerName)) return null;

  // Skip optional whitespace, then expect '>'
  let scan = nameEnd;
  while (scan < text.length && text[scan] === ' ') scan++;
  if (scan >= text.length || text[scan] !== '>') return null;

  return {
    length: scan - pos + 1, // total characters consumed: '<' ... '>'
    isClosing,
    tagName: lowerName,
  };
}

/**
 * Parse a string with optional HTML formatting tags into TextRun objects.
 * Supported: <b>/<strong>, <i>/<em>, <u>. Nested tags supported.
 * Unknown tags are treated as literal text.
 *
 * @param {string} text - Raw text, possibly with HTML tags
 * @returns {TextRun[]} Array of TextRun objects with appropriate formatting
 */
export function parseRichText(text) {
  if (!text) return [];

  const results = [];
  let buffer = '';
  const activeTags = new Set();
  let i = 0;

  while (i < text.length) {
    if (text[i] !== '<') {
      buffer += text[i];
      i++;
      continue;
    }

    const tag = tryParseTag(text, i);

    if (!tag) {
      // Unknown/malformed tag — treat '<' as literal text
      buffer += text[i];
      i++;
      continue;
    }

    // Flush accumulated text before the tag (with CURRENT formatting)
    if (buffer) {
      results.push(new TextRun({ text: buffer, ...makeFormatting(activeTags) }));
      buffer = '';
    }

    const tagKey = TAG_MAP[tag.tagName];

    if (tag.isClosing) {
      activeTags.delete(tagKey);
    } else {
      activeTags.add(tagKey);
    }

    // Skip past the entire tag
    i += tag.length;
  }

  // Flush any remaining buffer
  if (buffer) {
    results.push(new TextRun({ text: buffer, ...makeFormatting(activeTags) }));
  }

  // Filter out empty TextRuns
  return results.filter((run) => run.text !== '');
}
