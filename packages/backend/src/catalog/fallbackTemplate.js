/**
 * Fallback template — hardcoded copy of classic.json.
 * Used when a requested template file is missing or fails zod validation.
 * MUST stay in sync with config/templates/classic.json.
 */
export const FALLBACK_TEMPLATE = {
  id: 'classic',
  name: 'Классический',
  description: 'Times New Roman 14 пт, полуторный интервал, адресат справа вверху, номер страницы сверху по центру со второй страницы',
  preview: null,
  organization: { name: '', address: '', phone: '' },
  page: { marginsMm: { top: 20, right: 10, bottom: 20, left: 30 } },
  font: { family: 'Times New Roman', sizePt: 14 },
  paragraph: { lineSpacing: 1.5, firstLineIndentMm: 12.5, align: 'justify', spaceAfterPt: 0 },
  header: { pageNumber: 'center', firstPage: false, text: null },
  footer: { text: null },
  blocks: {
    orgHeader:  { show: true, align: 'center', bold: true },
    addressee:  { position: 'right', widthPercent: 45 },
    docTitle:   { align: 'center', bold: true },
    dateNumber: { layout: 'row' },
    title:      { align: 'left', bold: false, italic: false },
    signature:  { layout: 'row' },
  },
  placeholder: { format: '[{label}]', highlight: 'yellow' },
  autoFill: { date: true },
  dateFormat: 'DD.MM.YYYY',
};
