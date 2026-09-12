/**
 * Merges sources of field values in priority order:
 * user answer > AI-verified value > auto value > template value.
 *
 * Keys are now Russian labels (Адресат, Дата, Номер, etc.).
 * Merges template.requiredFields ∪ docType.fields → unique set by key (Russian label).
 *
 * @param {Object} params
 * @param {Object} params.docType - Document type config from catalog
 * @param {Object} params.template - Template config from catalog
 * @param {Object} params.aiFields - AI-extracted fields: { key: { value, quote } | null }
 * @param {string|null} params.title - AI-derived title
 * @param {Object} params.userFields - User-provided fields: { key: "value" | null }
 * @param {string} params.today - Today's date string (YYYY-MM-DD)
 * @returns {{
 *   values: Record<string, { value: string|null, label: string, source: string }>,
 *   pending: Array<{ key: string, label: string, question: string, example: string }>,
 *   placeholders: string[]
 * }}
 */
export function mergeRequisites({ docType, template, aiFields, title, userFields, today }) {
  const values = {};
  const pending = [];
  const placeholders = [];

  // Step 1: Merge template.requiredFields ∪ docType.fields → unique set by key (Russian label)
  // docType.fields has { key, label, kind, required, question, example }
  // template.requiredFields is an array of Russian label strings
  const fieldsByLabel = new Map();

  // Start with docType.fields (these have full metadata)
  for (const field of docType.fields) {
    fieldsByLabel.set(field.key, field);
  }

  // Add requiredFields from template that aren't already in docType.fields
  // These become basic field descriptors with kind: 'required'
  for (const requiredKey of (template.requiredFields || [])) {
    if (!fieldsByLabel.has(requiredKey)) {
      fieldsByLabel.set(requiredKey, {
        key: requiredKey,
        label: requiredKey,
        kind: 'required',
        required: true,
      });
    }
  }

  // Step 2: For each field in the merged set, apply priority chain
  for (const [fieldKey, field] of fieldsByLabel) {
    const userVal = userFields[fieldKey];
    const aiVal = aiFields?.[fieldKey];

    let value = null;
    let source = null;

    // Priority 1: User explicitly provided a value
    if (userVal !== undefined && userVal !== null) {
      value = userVal;
      source = 'user';
    }
    // Priority 2: User explicitly set to null (leave empty)
    else if (userVal === null) {
      value = null;
      source = 'user_skip';
    }
    // Priority 3: AI-verified value (including ungrounded)
    else if (aiVal && aiVal.value) {
      value = aiVal.value;
      source = aiVal.ungrounded ? 'ai_ungrounded' : 'ai';
    }
    // Priority 4: Auto value (date) — key is "Дата" now, not "date"
    else if (field.kind === 'auto' && fieldKey === 'Дата' && template.autoFill?.date) {
      value = formatDate(today, template.dateFormat);
      source = 'auto';
    }
    // Priority 5: Template value (organization info)
    else if (field.kind === 'template') {
      value = template.organization?.[fieldKey] ?? null;
      source = 'template';
    }

    // Handle title specially — userFields.title first, then AI title
    // Key is "Заголовок" (or whatever the Russian label for title is)
    // For now, check if this is the title field by looking for common Russian title labels
    if (fieldKey === 'Тема' && value === null) {
      if (userFields['Тема'] !== undefined && userFields['Тема'] !== null) {
        value = userFields['Тема'];
        source = 'user';
      } else if (title) {
        value = title;
        source = 'ai';
      }
    }

    values[fieldKey] = {
      value,
      label: field.label,
      source: source || 'none',
    };

    // Determine if field needs to be asked
    const isRegistry = field.kind === 'registry';
    const isSkipped = userVal === null;
    const hasValue = value !== null && value !== undefined && String(value).trim() !== '';

    if (isRegistry) {
      // Registry fields never go to pending — always show as placeholder
      placeholders.push(field.label);
    } else if (!hasValue && !isSkipped && field.required) {
      // Required field without value and not skipped → ask user
      pending.push({
        key: fieldKey,
        label: field.label,
        question: field.question || `Укажите: ${field.label}`,
        example: field.example || '',
      });
    } else if (!hasValue && !field.required) {
      // Optional field without value → placeholder
      placeholders.push(field.label);
    }
  }

  return { values, pending, placeholders };
}

/**
 * Format date according to template format.
 * @param {string} isoDate - ISO date string (YYYY-MM-DD)
 * @param {string} format - Template date format (e.g., "DD.MM.YYYY")
 * @returns {string}
 */
function formatDate(isoDate, format) {
  // UTC-геттеры: 'YYYY-MM-DD' разбирается как полночь UTC, и в часовых поясах западнее Гринвича
  // локальные getDate()/getMonth() дали бы предыдущий день.
  const d = new Date(isoDate);
  const dayNum = d.getUTCDate();
  const monthIdx = d.getUTCMonth();
  const year = String(d.getUTCFullYear());
  const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

  return format
    .replace(/MMMM/g, months[monthIdx])
    .replace(/DD/g, String(dayNum).padStart(2, '0'))
    .replace(/D/g, String(dayNum))
    .replace(/MM/g, String(monthIdx + 1).padStart(2, '0'))
    .replace(/YYYY/g, year)
    .replace(/YY/g, year.slice(-2));
}
