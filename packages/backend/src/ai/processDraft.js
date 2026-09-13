import { buildMessages } from './prompt.js';
import { extractJson, AiResultSchema } from './schema.js';
import { checkGrounding, checkDerivedGrounding } from '../validation/grounding.js';
import { AiUnavailableError, AiInvalidResponseError } from '../core/errors.js';
import { stripMarkup } from '../validation/normalize.js';

// Английские ключи, которые модели подставляют вместо русских ключей типа документа.
const FIELD_KEY_ALIASES = {
  addressee: 'Адресат', recipient: 'Адресат', to: 'Адресат',
  subject: 'Тема', topic: 'Тема', title: 'Тема',
  authorname: 'ФИО автора', author: 'ФИО автора', authorfullname: 'ФИО автора', from: 'ФИО автора',
  authorposition: 'Должность автора', position: 'Должность автора',
  authordepartment: 'Наименование подразделения', department: 'Наименование подразделения', subdivision: 'Наименование подразделения',
  signername: 'ФИО подписывающего', signatoryname: 'ФИО подписывающего',
  signerposition: 'Должность подписывающего', signatoryposition: 'Должность подписывающего',
  addresseeorg: 'Организация адресата', recipientorganization: 'Организация адресата',
  addresseeperson: 'Лицо адресата', addresseeaddress: 'Адрес адресата',
  salutation: 'Обращение', executor: 'Исполнитель', period: 'Период', date: 'Дата', number: 'Номер',
  applicantname: 'ФИО заявителя', headname: 'ФИО руководителя', headposition: 'Должность руководителя',
  chairmanname: 'ФИО председателя', secretaryname: 'ФИО секретаря', protocolnumber: 'Номер протокола',
};

/**
 * Resolve a key from the AI answer to a field of the doc type: exact key, label,
 * case/spacing variants, then the English alias table.
 */
function resolveFieldKey(docType, rawKey) {
  const exact = docType.fields.find(f => f.key === rawKey);
  if (exact) return exact;
  const loose = String(rawKey).toLowerCase().replace(/[\s_\-]+/g, '');
  const byName = docType.fields.find(f =>
    f.key.toLowerCase().replace(/\s+/g, '') === loose || f.label.toLowerCase().replace(/\s+/g, '') === loose);
  if (byName) return byName;
  const alias = FIELD_KEY_ALIASES[loose];
  return alias ? docType.fields.find(f => f.key === alias) ?? null : null;
}

function cleanField(fieldVal) {
  if (!fieldVal) return fieldVal;
  return { ...fieldVal, value: stripMarkup(fieldVal.value) };
}

/**
 * Process a draft through the AI pipeline.
 *
 * Flow:
 * 1. Check fault injection → maybe throw
 * 2. Build messages from draft + docType
 * 3. Call AI provider → parse JSON response
 * 4. Validate with Zod schema
 * 5. Grounding check on extract + derived fields
 * 6. Return normalized result with groundedFields list
 *
 * Retry policy: on first JSON parse failure, rebuild messages with stronger instruction.
 * After two failures → AiInvalidResponseError.
 *
 * @param {{ draft: string, docType: object, userFields: object, provider: object, log?: object, faultManager?: object, ownerKey?: string }} params
 * @returns {{ title: string|null, body: string[], aiFields: object, changes: string[], warnings: object[], groundedFields: Array<{key: string, reason: string}> }}
 */
export async function processDraft({ draft, docType, userFields, provider, log, faultManager, ownerKey }) {
  const warnings = [];
  const groundedFields = [];

  // Step 0: Fault injection check
  if (faultManager && ownerKey && faultManager.shouldFault(ownerKey)) {
    // retryable: false — иначе очередь повторит задание и пользователь не увидит ошибку (сценарий 6)
    throw new AiUnavailableError('AI fault injected', { retryable: false });
  }

  // Step 1: Build messages and call AI
  const messages = buildMessages({ draft, docType });

  log?.debug({
    provider: provider.name,
    draftLength: draft.length,
    docType: docType?.id ?? docType,
    promptChars: messages.reduce((sum, m) => sum + m.content.length, 0),
  }, 'запрос к ИИ отправлен');

  let raw;
  const aiStartedAt = Date.now();
  try {
    raw = await provider.complete(messages);
  } catch (err) {
    log?.warn({ provider: provider.name, ms: Date.now() - aiStartedAt, error: err.message }, 'вызов ИИ не удался');
    if (err instanceof AiUnavailableError) throw err;
    throw new AiUnavailableError(`AI call failed: ${err.message}`);
  }

  log?.debug({ provider: provider.name, ms: Date.now() - aiStartedAt, rawLength: raw.length, raw }, 'ответ ИИ получен');

  // Step 2: Parse JSON (with one retry — rebuild messages with stronger instruction)
  let parsed;
  try {
    parsed = extractJson(raw);
  } catch (err) {
    log?.warn({ error: err.message }, 'ai_json_parse_failed, retrying');
    // H6: Rebuild messages with stronger system instruction instead of appending user message
    const retryMessages = [
      { role: 'system', content: messages[0].content + '\n\nВАЖНО: предыдущий ответ не удалось разобрать как JSON. Верни ровно один JSON-объект по схеме из раздела «Формат ответа»: первый символ ответа — {, последний — }. Никакого текста, пояснений и markdown-обёрток.' },
      { role: 'user', content: messages[1].content },
    ];
    try {
      raw = await provider.complete(retryMessages);
      parsed = extractJson(raw);
    } catch (err2) {
      throw new AiInvalidResponseError(`AI returned invalid JSON twice: ${err2.message}`);
    }
  }

  // Step 3: Validate with Zod schema (with one retry — feed errors back to AI)
  let result;
  try {
    result = AiResultSchema.parse(parsed);
  } catch (err) {
    log?.warn({ zodErrors: err.issues }, 'ai_schema_validation_failed, retrying');
    const formattedErrors = err.issues
      .map(e => `  - поле «${e.path.join('.')}»: ${e.message}`)
      .join('\n');
    const retryMessages = [
      { role: 'system', content: messages[0].content + '\n\nВАЖНО: ответ должен точно соответствовать схеме ответа из раздела «Формат ответа»: title — строка или null; body — массив от 1 до 50 непустых строк; fields — объект с русскими ключами из списка полей, где каждое значение — { "value": "непустая строка", "quote": "дословная цитата или null" } или null; changes — массив строк, не больше 10.' },
      {
        role: 'user',
        content: `Черновик:\n<draft>\n${draft}\n</draft>\n\nТвой предыдущий ответ не прошёл валидацию схемы. Ошибки:\n${formattedErrors}\n\nТвой ответ:\n${raw}\n\nИсправь только перечисленные ошибки, сохранив содержание ответа, и верни исправленный JSON-объект целиком — без пояснений и markdown.`,
      },
    ];
    try {
      raw = await provider.complete(retryMessages);
      parsed = extractJson(raw);
      result = AiResultSchema.parse(parsed);
    } catch (err2) {
      const retryDetail = err2 instanceof Error && err2.name === 'ZodError'
        ? `Retry also failed schema: ${JSON.stringify(err2.issues)}`
        : `AI returned invalid response twice: ${err2.message}`;
      throw new AiInvalidResponseError(`AI response failed schema twice. First: ${err.message}. ${retryDetail}`);
    }
  }

  // Разметку (<b>, **…**) в документ не пропускаем: оформление задаёт шаблон.
  result.title = result.title ? stripMarkup(result.title) || null : null;
  const body = result.body.map(stripMarkup).filter(Boolean);
  if (body.length === 0) throw new AiInvalidResponseError('AI returned an empty body after removing markup');
  const changes = result.changes.map(stripMarkup).filter(Boolean);

  // Step 4: Grounding check on extract AND derived fields
  const aiFields = {};
  for (const [rawKey, rawVal] of Object.entries(result.fields)) {
    const fieldDef = resolveFieldKey(docType, rawKey);
    if (!fieldDef) {
      log?.debug({ key: rawKey }, 'ai_field_unknown_key_dropped');
      continue;
    }
    const key = fieldDef.key;
    const fieldVal = cleanField(rawVal);

    if (fieldVal === null) {
      // Не затираем значение, найденное под другим (алиасным) ключом
      if (!(key in aiFields)) aiFields[key] = null;
      continue;
    }
    if (!fieldVal.value) continue;

    // Grounding check for "extract" kind fields — strict (quote must be in source)
    if (fieldDef.kind === 'extract') {
      // No quote → nothing proves the value came from the draft
      const check = fieldVal.quote
        ? checkGrounding(fieldVal.value, fieldVal.quote, draft)
        : { ok: false, reason: 'quote_missing' };
      if (!check.ok) {
        log?.debug({ key, reason: check.reason }, 'field_grounding_failed');
        warnings.push({ key, reason: check.reason, severity: 'grounding' });
        groundedFields.push({ key, reason: check.reason });
        // Preserve value with ungrounded flag — flows to DOCX as 'ai_ungrounded' source
        aiFields[key] = { ...fieldVal, ungrounded: true };
        continue;
      }
    }

    // H1: Grounding check for "derived" kind fields — relaxed (at least one word from draft)
    if (fieldDef.kind === 'derived' && fieldVal.value) {
      const check = checkDerivedGrounding(fieldVal.value, draft);
      if (!check.ok) {
        log?.debug({ key, reason: check.reason }, 'derived_field_grounding_failed');
        warnings.push({ key, reason: check.reason, severity: 'grounding' });
        groundedFields.push({ key, reason: check.reason });
        // Preserve value with ungrounded flag — flows to DOCX as 'ai_ungrounded' source
        aiFields[key] = { ...fieldVal, ungrounded: true };
        continue;
      }
    }

    aiFields[key] = fieldVal;
  }

  // The title is written by the prompt's grammar rule («О» + предложный падеж); the Тема field
  // often comes back in the nominative («Закупка мониторов») and would print as «О Закупка…».
  const subjectDef = docType.fields.find(f => f.key === 'Тема');
  if (subjectDef && result.title && /^о\s/i.test(result.title) && !/^о\s/i.test(aiFields['Тема']?.value ?? '')) {
    aiFields['Тема'] = { value: result.title, quote: null };
  }

  log?.debug({
    title: result.title,
    paragraphs: body.length,
    fields: Object.fromEntries(Object.entries(aiFields).map(([key, val]) => [key, val?.value ?? null])),
    changes: result.changes,
    warnings: warnings.map((w) => `${w.key}: ${w.reason}`),
  }, 'ответ ИИ разобран и проверен');

  return {
    title: result.title,
    body,
    aiFields,
    changes,
    warnings,
    groundedFields,
  };
}
