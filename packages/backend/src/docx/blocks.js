import { Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, UnderlineType } from 'docx';
import { mm, halfPt } from './units.js';
import { parseRichText } from './richText.js';

/**
 * @typedef {{
 *   docType: object,
 *   template: object,
 *   values: Record<string, { value: string|null, label: string, source: string }>,
 *   title: string|null,
 *   body: string[]
 * }} RenderModel
 */

const ALIGN = {
  left: AlignmentType.LEFT,
  right: AlignmentType.RIGHT,
  center: AlignmentType.CENTER,
  justify: AlignmentType.JUSTIFIED,
};

/**
 * Returns a TextRun with the field value, or a highlighted placeholder [Label]
 * when the value is missing. All unfilled placeholders MUST go through this
 * function to ensure consistent formatting.
 *
 * @param {RenderModel} model
 * @param {string} key  field key (e.g. 'Адресат', 'Дата', 'Номер')
 * @returns {TextRun|TextRun[]}
 */
export function valueRuns(model, key) {
  const val = model.values[key]?.value;
  // Empty string "" is intentionally treated as missing — it falls through to the placeholder.
  // This matches the AI extraction behavior: empty fields come back as "" not null.
  if (val) {
    return [new TextRun(val)];
  }
  const label = model.values[key]?.label ?? key;
  return [new TextRun({
    text: `[${label}]`,
    highlight: model.template.placeholder.highlight ?? undefined,
  })];
}

// ── Block functions ─────────────────────────────────────────────────────────

/**
 * Organization header — name, INN/KPP/OGRN (ГОСТ), and address/phone from template.
 * For 'modern' template: empty (org is in the header).
 *
 * ГОСТ format:
 *   [Название организации]
 *   ИНН: [ИНН] КПП: [КПП] ОГРН: [ОГРН]
 *   [Адрес] [Телефон]
 */
function orgHeader(model) {
  const t = model.template;
  const cfg = t.blocks.orgHeader;
  if (!cfg.show) return [];

  const runs = [];
  runs.push(new TextRun({ text: t.organization.name, bold: cfg.bold }));

  // ГОСТ: render ИНН/КПП/ОГРН if any are present in the organization object
  const inn = t.organization.inn;
  const kpp = t.organization.kpp;
  const ogrn = t.organization.ogrn;
  if (inn || kpp || ogrn) {
    const idParts = [];
    if (inn) idParts.push(`ИНН: ${inn}`);
    if (kpp) idParts.push(`КПП: ${kpp}`);
    if (ogrn) idParts.push(`ОГРН: ${ogrn}`);
    runs.push(new TextRun({ text: `\n${idParts.join(' ')}`, bold: cfg.bold }));
  }

  // Address and phone on the same line (ГОСТ: [Адрес] [Телефон])
  const contactParts = [];
  if (t.organization.address) contactParts.push(t.organization.address);
  if (t.organization.phone) contactParts.push(t.organization.phone);
  if (contactParts.length > 0) {
    runs.push(new TextRun({ text: `\n${contactParts.join(' ')}`, bold: cfg.bold }));
  }

  return [new Paragraph({
    alignment: ALIGN[cfg.align],
    children: runs,
  })];
}

/**
 * Addressee block.
 * position "right": borderless table, 2 columns (left empty, right = widthPercent%).
 * position "left": paragraphs without indent.
 * For letter: outputs Организация адресата, Лицо адресата, Адрес адресата separately.
 */
function addressee(model) {
  const t = model.template;
  const cfg = t.blocks.addressee;
  const isLetter = model.docType.id === 'letter';

  if (cfg.position === 'right') {
    // Table without borders, two columns
    const cells = [
      new TableCell({ children: [new Paragraph({ children: [] })], borders: noBorders() }),
      new TableCell({
        width: { size: cfg.widthPercent, type: WidthType.PERCENTAGE },
        children: isLetter ? letterAddresseeParas(model) : [new Paragraph({ children: valueRuns(model, 'Адресат') })],
        borders: noBorders(),
      }),
    ];
    return [new Table({ rows: [new TableRow({ children: cells })] })];
  }

  // position === 'left': plain paragraphs, no indent
  if (isLetter) return letterAddresseeParas(model);
  return [new Paragraph({ children: valueRuns(model, 'Адресат') })];
}

/** Letter-specific addressee: three separate paragraphs. */
function letterAddresseeParas(model) {
  return [
    new Paragraph({ children: valueRuns(model, 'Организация адресата') }),
    new Paragraph({ children: valueRuns(model, 'Лицо адресата') }),
    new Paragraph({ children: valueRuns(model, 'Адрес адресата') }),
  ];
}

/**
 * Document type title (e.g. "СЛУЖЕБНАЯ ЗАПИСКА").
 * Skipped for letter (docTitle is null).
 */
function docTitle(model) {
  const dt = model.docType;
  if (!dt.docTitle) return [];

  const cfg = model.template.blocks.docTitle;
  return [new Paragraph({
    alignment: ALIGN[cfg.align],
    children: [new TextRun({ text: dt.docTitle, bold: cfg.bold })],
  })];
}

/**
 * Date and number row.
 * "row" layout: both in one borderless table row.
 * "stack" layout: two separate paragraphs.
 *
 * ГОСТ: date is prefixed with "от" (e.g. "от 12 сентября 2026 г.").
 */
function dateNumber(model, prefix = '№') {
  const cfg = model.template.blocks.dateNumber;
  // ГОСТ: prepend "от " to the date value, but only if not already present
  const dateVal = model.values['Дата']?.value;
  const dateRuns = dateVal && dateVal.startsWith('от ')
    ? [...valueRuns(model, 'Дата')]
    : [new TextRun('от '), ...valueRuns(model, 'Дата')];
  // ГОСТ: prefix is configurable — letters use "Исх." (outgoing), others use "№".
  const numberParaRuns = model.values['Номер']?.value
    ? [new TextRun(` ${prefix} ${model.values['Номер'].value}`)]
    : [new TextRun(` ${prefix} `), ...valueRuns(model, 'Номер')];

  if (cfg.layout === 'row') {
    return [new Table({
      rows: [new TableRow({
        children: [
          new TableCell({
            width: { size: 50, type: WidthType.PERCENTAGE },
            children: [new Paragraph({ children: dateRuns })],
            borders: noBorders(),
          }),
          new TableCell({
            width: { size: 50, type: WidthType.PERCENTAGE },
            children: [new Paragraph({ children: numberParaRuns })],
            borders: noBorders(),
          }),
        ],
      })],
    })];
  }

  // stack layout
  return [
    new Paragraph({ children: dateRuns }),
    new Paragraph({ children: numberParaRuns }),
  ];
}

/**
 * Title paragraph: "О ..." from version.title or placeholder.
 */
function title(model) {
  const cfg = model.template.blocks.title;
  // Some providers (mock) already return a title prefixed with "О " — do not double it.
  // Also skip generic/fallback titles like "Документ" that produce meaningless "О Документ".
  const raw = model.title?.trim();
  const isGeneric = !raw || /^документ$/i.test(raw);
  let titleText;
  if (isGeneric) {
    titleText = null;
  } else if (/^о\s/i.test(raw)) {
    // Already has "О " — enforce Prepositional case on the first word after "О "
    titleText = enforcePrepositional(raw);
  } else {
    // No "О " prefix — add it and enforce Prepositional case
    titleText = enforcePrepositional(`О ${raw}`);
  }
  const runs = titleText
    ? [new TextRun({ text: titleText, bold: cfg.bold, italics: cfg.italic })]
    : [new TextRun({ text: 'О ', bold: cfg.bold, italics: cfg.italic }), ...valueRuns(model, 'Тема')];
  return [new Paragraph({
    alignment: ALIGN[cfg.align],
    children: runs,
  })];
}

/**
 * Enforce Prepositional case (Предложный падеж) on the word after "О ".
 * Handles common Nominative→Prepositional patterns for adjectives and nouns.
 * This is a heuristic — covers ~80% of business document titles.
 */
function enforcePrepositional(text) {
  const match = text.match(/^(О\s+)(\S+)(.*)$/i);
  if (!match) return text;
  const [, prefix, word, rest] = match;
  // Already in Prepositional? (common endings: -ых, -их, -ах, -ях, -ом, -ем, -и, -ой, -ей)
  if (/(?:ых|их|ах|ях|ом|ем|ой|ей)$/i.test(word)) return text;
  let fixed = word;
  // Adjectives: -ые → -ых, -ие → -их, -ая → -ой, -яя → -ей
  fixed = fixed.replace(/ые$/i, 'ых');
  fixed = fixed.replace(/ие$/i, 'их');
  fixed = fixed.replace(/ая$/i, 'ой');
  fixed = fixed.replace(/яя$/i, 'ей');
  // Nouns: -ы → -ах, -а → -е (for feminine nouns like "записка")
  fixed = fixed.replace(/ы$/i, 'ах');
  fixed = fixed.replace(/а$/i, 'е');
  return `${prefix}${fixed}${rest}`;
}

/**
 * Salutation paragraph — centered, letter only.
 */
function salutation(model) {
  if (!model.values['Обращение']?.value) return [];
  return [new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun(model.values['Обращение'].value)],
  })];
}

/**
 * Body paragraphs — with firstLineIndentMm and align from template.
 */
function body(model) {
  const t = model.template;
  return (model.body || []).map((text) => new Paragraph({
    alignment: ALIGN[t.paragraph.align],
    indent: t.paragraph.firstLineIndentMm > 0
      ? { firstLine: mm(t.paragraph.firstLineIndentMm) }
      : undefined,
    children: parseRichText(text),
  }));
}

/**
 * Signature block.
 * "row" layout: position left, name right (borderless table).
 * "stack" layout: position over name (modern).
 *
 * Memo/report: Должность автора + ФИО автора.
 * Letter: Должность подписывающего + ФИО подписывающего.
 *
 * ГОСТ: underlined space for wet signature between position and name.
 *
 * NOTE: Letter uses different field keys than other docTypes.
 */
function signature(model) {
  const isLetter = model.docType.id === 'letter';
  const posKey = isLetter ? 'Должность подписывающего' : 'Должность автора';
  const nameKey = isLetter ? 'ФИО подписывающего' : 'ФИО автора';
  const cfg = model.template.blocks.signature;

  // ГОСТ: underlined line for wet signature
  const underlineRun = new TextRun({
    text: '____________________',
    underline: { type: UnderlineType.SINGLE },
  });

  if (cfg.layout === 'row') {
    return [new Table({
      rows: [new TableRow({
        children: [
          new TableCell({
            width: { size: 50, type: WidthType.PERCENTAGE },
            children: [
              new Paragraph({ children: valueRuns(model, posKey) }),
              new Paragraph({ children: [underlineRun] }),
            ],
            borders: noBorders(),
          }),
          new TableCell({
            width: { size: 50, type: WidthType.PERCENTAGE },
            children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: valueRuns(model, nameKey) })],
            borders: noBorders(),
          }),
        ],
      })],
    })];
  }

  // stack layout
  return [
    new Paragraph({ children: valueRuns(model, posKey) }),
    new Paragraph({ children: [underlineRun] }),
    new Paragraph({ children: valueRuns(model, nameKey) }),
  ];
}

/**
 * Executor — small font at bottom, letter only.
 *
 * ГОСТ format:
 *   Исп.: [ФИО исполнителя]
 *   Тел.: [Телефон]
 */
function executor(model) {
  if (!model.values['Исполнитель']?.value) return [];
  const t = model.template;
  const fontSize = halfPt(t.font.sizePt - 2);

  // Phone: show value or placeholder
  const phoneVal = model.values['Телефон исполнителя']?.value;
  const phoneLabel = model.values['Телефон исполнителя']?.label ?? 'Телефон';
  const phoneRuns = phoneVal
    ? [new TextRun({ text: phoneVal, size: fontSize })]
    : [new TextRun({
        text: `[${phoneLabel}]`,
        size: fontSize,
        highlight: model.template.placeholder.highlight ?? undefined,
      })];

  return [
    new Paragraph({
      children: [
        new TextRun({ text: 'Исп.: ', size: fontSize }),
        new TextRun({ text: model.values['Исполнитель'].value, size: fontSize }),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({ text: 'Тел.: ', size: fontSize }),
        ...phoneRuns,
      ],
    }),
  ];
}

/**
 * Recipient block for letters — right-aligned.
 * ГОСТ: shows Кому → Должность → ФИО as separate right-aligned paragraphs.
 */
function recipientBlock(model) {
  if (model.docType.id !== 'letter') return [];

  const fields = ['Кому', 'Должность получателя', 'ФИО получателя'];
  const paragraphs = [];

  for (const field of fields) {
    const entry = model.values[field];
    if (entry?.value || entry?.label) {
      paragraphs.push(new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: valueRuns(model, field),
      }));
    }
  }

  return paragraphs;
}

// ── ГОСТ blocks ──────────────────────────────────────────────────────────────

/**
 * Гриф утверждения — approval block.
 * Top-right, before title. Shows УТВЕРЖДАЮ + position + signature line + name + date.
 */
function approvalBlock(model) {
  const approval = model['Утверждение'] || model.approval;
  if (!approval) return [];

  return [
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { after: 120 },
      children: [new TextRun({ text: 'УТВЕРЖДАЮ', bold: true, size: halfPt(model.template.font.sizePt) })],
    }),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [new TextRun({ text: approval.position || '', size: halfPt(model.template.font.sizePt) })],
    }),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [
        new TextRun({ text: '_________________  ', size: halfPt(model.template.font.sizePt) }),
        new TextRun({ text: approval.signature || '', size: halfPt(model.template.font.sizePt) }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [new TextRun({ text: approval.name || '', size: halfPt(model.template.font.sizePt) })],
    }),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [new TextRun({ text: approval.date || '', size: halfPt(model.template.font.sizePt) })],
    }),
  ];
}

/**
 * Согласовано — agreement block.
 * Top-right, after approval block if both exist.
 */
function agreementBlock(model) {
  const agreement = model['Согласование'] || model.agreement;
  if (!agreement) return [];

  return [
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { after: 120 },
      children: [new TextRun({ text: 'СОГЛАСОВАНО', bold: true, size: halfPt(model.template.font.sizePt) })],
    }),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [new TextRun({ text: agreement.position || '', size: halfPt(model.template.font.sizePt) })],
    }),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [
        new TextRun({ text: '_________________  ', size: halfPt(model.template.font.sizePt) }),
        new TextRun({ text: agreement.signature || '', size: halfPt(model.template.font.sizePt) }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [new TextRun({ text: agreement.name || '', size: halfPt(model.template.font.sizePt) })],
    }),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [new TextRun({ text: agreement.date || '', size: halfPt(model.template.font.sizePt) })],
    }),
  ];
}

/**
 * Приложение — attachment list.
 * After body, before signature. Lists document attachments.
 */
function attachmentBlock(model) {
  const attachments = model['Приложение'] || model.attachments;
  if (!attachments || !Array.isArray(attachments) || attachments.length === 0) return [];

  const lines = [
    new Paragraph({
      spacing: { before: 240 },
      children: [new TextRun({ text: 'Приложение:', bold: true, size: halfPt(model.template.font.sizePt) })],
    }),
  ];

  attachments.forEach((att, i) => {
    lines.push(new Paragraph({
      children: [new TextRun({ text: `${i + 1}. ${att}`, size: halfPt(model.template.font.sizePt) })],
    }));
  });

  return lines;
}

/**
 * Копия — distribution/CC list.
 * After signature, left-aligned. Lists recipients.
 */
function copyBlock(model) {
  const copies = model['Копия'] || model.copies;
  if (!copies || !Array.isArray(copies) || copies.length === 0) return [];

  const lines = [
    new Paragraph({
      spacing: { before: 240 },
      children: [new TextRun({ text: 'Копия:', bold: true, size: halfPt(model.template.font.sizePt) })],
    }),
  ];

  copies.forEach((copy) => {
    const text = typeof copy === 'string'
      ? copy
      : `${copy.name || ''} — ${copy.position || ''}`;
    lines.push(new Paragraph({
      children: [new TextRun({ text, size: halfPt(model.template.font.sizePt) })],
    }));
  });

  return lines;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Returns zero-width border config for borderless table cells. */
function noBorders() {
  const b = { style: 'none', size: 0, color: 'FFFFFF' };
  return { top: b, bottom: b, left: b, right: b };
}

// ── Layout builder ─────────────────────────────────────────────────────────

/**
 * Generic layout builder — reads the block sequence from docType.layout
 * and calls each block function in order.
 *
 * Layout entries can be:
 *   - A string: "blockName" → calls BLOCKS[blockName](model)
 *   - An array: ["blockName", arg1, ...] → calls BLOCKS[blockName](model, arg1, ...)
 *
 * This keeps layout ordering in the docType JSON config — adding a new doc type
 * requires ONLY a JSON config file, no new layout functions.
 *
 * Block functions read their own config from model.template.blocks.*,
 * so the builder only specifies the sequence and optional extra arguments.
 *
 * @param {RenderModel} model
 * @returns {(Paragraph|Table)[]}
 */
function buildLayout(model) {
  const layoutConfig = model.docType.layout;
  if (!layoutConfig || !Array.isArray(layoutConfig)) {
    throw new Error(`docType=${model.docType.id} has no layout array`);
  }

  const elements = [];

  for (const entry of layoutConfig) {
    // Normalize: string → [name], array → [name, ...args]
    const [blockName, ...args] = Array.isArray(entry) ? entry : [entry];
    const blockFn = BLOCKS[blockName];

    if (!blockFn) {
      throw new Error(`Unknown block "${blockName}" in layout for docType=${model.docType.id}`);
    }

    elements.push(...blockFn(model, ...args));
  }

  return elements;
}

// ── Export ──────────────────────────────────────────────────────────────────

/**
 * Main entry point — generates the full document layout for a given
 * template+docType combination with [Label] placeholders.
 *
 * Layout sequence is read from docType.layout JSON array.
 *
 * @param {RenderModel} model
 * @returns {(Paragraph|Table)[]}
 */
export function construct(model) {
  return buildLayout(model);
}

/**
 * Registry of block functions, keyed by block name.
 * Each function receives the full RenderModel (and optional extra args)
 * and returns (Paragraph|Table)[].
 *
 * @type {Record<string, (model: RenderModel, ...args: any[]) => (Paragraph|Table)[]>}
 */
export const BLOCKS = {
  orgHeader,
  addressee,
  docTitle,
  dateNumber,
  title,
  salutation,
  body,
  signature,
  executor,
  recipientBlock,
  approvalBlock,
  agreementBlock,
  attachmentBlock,
  copyBlock,
};
