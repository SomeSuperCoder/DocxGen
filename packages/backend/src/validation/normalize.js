/**
 * Normalize text for comparison: lowercase, ё→е, unify quotes/dashes,
 * remove punctuation except .,№%, collapse spaces.
 * @param {string} s
 * @returns {string}
 */
export function normalize(s) {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[""«»]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[^\p{L}\p{N}\s.,№%()+\-/]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Remove formatting markup that models add to business text: HTML tags (<b>, <br/>, <span …>)
 * and markdown emphasis (**жирный**, __подчёркнутый__). Comparison signs like «< 5 лет» stay.
 * @param {string} s
 * @returns {string}
 */
export function stripMarkup(s) {
  return String(s ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?[a-z][a-z0-9]*(?:\s[^<>]*)?\/?>/gi, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
