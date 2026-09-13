import JSZip from 'jszip';

const textFromXml = (xml = '') => xml
  .replace(/<w:tab\s*\/?>/g, ' ')
  .replace(/<w:br\s*\/?>/g, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/\s+/g, ' ').trim();

function firstMatch(xml, pattern, fallback) {
  const match = xml.match(pattern);
  return match?.[1] || fallback;
}

/** Convert a DOCX bланк into the same template contract used by renderDocx. */
export async function parseDocxTemplate(buffer, { id, name } = {}) {
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file('word/document.xml')?.async('text') || '';
  const stylesXml = await zip.file('word/styles.xml')?.async('text') || '';
  const headerFiles = Object.keys(zip.files).filter((file) => /word\/header\d+\.xml$/.test(file));
  const footerFiles = Object.keys(zip.files).filter((file) => /word\/footer\d+\.xml$/.test(file));
  const headerXml = headerFiles.length ? await zip.file(headerFiles[0]).async('text') : '';
  const footerXml = footerFiles.length ? await zip.file(footerFiles[0]).async('text') : '';
  const section = documentXml.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/)?.[0] || '';
  const margin = (side, fallback) => {
    const raw = firstMatch(section, new RegExp(`<w:${side}[^>]*w:w="(\\d+)"`), null);
    return raw ? Number(raw) * 0.01764 : fallback;
  };
  const font = firstMatch(stylesXml, /<w:rFonts[^>]*(?:w:ascii|w:hAnsi)="([^"]+)"/, 'Times New Roman');
  const sizeHalfPoints = Number(firstMatch(stylesXml, /<w:sz[^>]*w:val="(\d+)"/, '28'));
  const safeId = String(id || `imported-${Date.now()}`).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || `imported-${Date.now()}`;
  const label = name || 'Импортированный бланк';
  return {
    id: safeId,
    name: label,
    description: `Бланк из DOCX · ${font}, ${sizeHalfPoints / 2} пт`,
    preview: null,
    organization: { name: label },
    page: { marginsMm: { top: margin('top', 25), right: margin('right', 20), bottom: margin('bottom', 20), left: margin('left', 30) } },
    font: { family: font, sizePt: Math.max(8, Math.min(20, sizeHalfPoints / 2)) },
    paragraph: { lineSpacing: 1.15, firstLineIndentMm: 12.5, align: 'justify', spaceAfterPt: 0 },
    header: { pageNumber: 'none', firstPage: false, text: textFromXml(headerXml) || null },
    footer: { text: textFromXml(footerXml) || null, pageNumber: 'none' },
    blocks: {},
    placeholder: { format: '[{label}]', highlight: 'FFFF00' },
    autoFill: { date: true },
    dateFormat: 'DD.MM.YYYY',
  };
}
