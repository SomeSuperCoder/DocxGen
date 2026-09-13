import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT_PATH = path.join(__dirname, '../../../../prompts/system.md');

let cachedPrompt = null;

/**
 * Load the system prompt from disk (cached after first read).
 * @returns {string}
 */
function getSystemPrompt() {
  if (!cachedPrompt) {
    cachedPrompt = fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf8');
  }
  return cachedPrompt;
}

/**
 * Build field-specific instructions per doc type.
 * Generates a dynamic list of fields with hints based on docType.fields.
 * @param {{ id: string, name: string, fields: Array<{key: string, label: string, kind: string, question?: string}> }} docType
 * @returns {string}
 */
function buildFieldKeyInstructions(docType) {
  const kindHints = {
    extract: 'найди в тексте',
    derived: 'создай на основе текста',
    auto: 'автоматически',
    registry: 'реестровый номер — не извлекай',
  };

  const fieldLines = docType.fields.map(field => {
    const hint = kindHints[field.kind] || '';
    const questionPart = field.question ? ` — ${field.question}` : '';
    return `- ${field.key} (${field.label}${hint ? ' — ' + hint : ''}${questionPart})`;
  });

  return `Для документа типа ${docType.name.replace(/\{/g, '\\{')} извлекай:\n${fieldLines.join('\n')}`;
}

/**
 * Build messages array for AI completion.
 *
 * @param {{ draft: string, template: { requiredFields: string[] }, docType: { id: string, name: string, structureHint: string, fields: Array<{key: string, label: string, kind: string, question?: string}> } }} params
 * @returns {Array<{role: string, content: string}>}
 */
export function buildMessages({ draft, template, docType }) {
  const fieldsList = docType.fields
    .filter(f => f.kind === 'extract' || f.kind === 'derived')
    .map(f => `- ${f.key}: ${f.label}${f.kind === 'extract' ? ' (найди в тексте)' : ' (создай на основе текста)'}${f.question ? ' — ' + f.question : ''}`)
    .join('\n');

  const fieldKeyInstructions = buildFieldKeyInstructions(docType);

  // Пример блока fields с настоящими ключами типа — иначе модели придумывают свои (addressee, authorName).
  const exampleEntries = docType.fields
    .filter(f => f.kind === 'extract' || f.kind === 'derived')
    .map(f => f.kind === 'extract'
      ? `    ${JSON.stringify(f.key)}: { "value": "Нормализованное значение", "quote": "Точная цитата из черновика" } или null`
      : `    ${JSON.stringify(f.key)}: { "value": "Значение, составленное по тексту", "quote": null } или null`);
  const fieldsJsonExample = exampleEntries.length ? `{\n${exampleEntries.join(',\n')}\n  }` : '{}';

  // Merge template.requiredFields (strings) with docType.fields (objects) → unique by label
  const existingLabels = new Set();
  if (template?.requiredFields) {
    for (const field of template.requiredFields) {
      existingLabels.add(field);
    }
  }
  for (const field of docType.fields) {
    existingLabels.add(field.label);
  }
  const existingPlaceholders = [...existingLabels].map(label => `[${label}]`).join(', ');

  const existingPlaceholdersSection = existingLabels.size > 0
    ? `Эти плейсхолдеры уже существуют в шаблоне: ${existingPlaceholders}.\nНЕ создавай дублирующие плейсхолдеры для этих полей.\nТы МОЖЕШЬ использовать их в тексте, если это необходимо.`
    : 'В шаблоне пока нет плейсхолдеров.';

  // Sanitize template variable values to prevent injection via {{ }}
  const safeDocTypeName = docType.name.replace(/\{/g, '\\{');
  const safeStructureHint = docType.structureHint.replace(/\{/g, '\\{');

  const systemPrompt = getSystemPrompt()
    .replaceAll('{{docTypeName}}', safeDocTypeName)
    .replaceAll('{{docTypeId}}', docType.id)
    .replaceAll('{{structureHint}}', safeStructureHint)
    .replaceAll('{{fieldsList}}', fieldsList)
    .replaceAll('{{fieldKeyInstructions}}', fieldKeyInstructions)
    .replaceAll('{{fieldsJsonExample}}', fieldsJsonExample)
    .replaceAll('{{existingPlaceholders}}', existingPlaceholdersSection);

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Черновик:\n<draft>\n${draft}\n</draft>` },
  ];
}
