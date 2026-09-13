# Architecture — Placeholder-Based Document Generation

DocxGen converts Russian text drafts into properly formatted DOCX documents using a placeholder-based system. The core idea: `[Label]` placeholders in both AI-generated text and template layout positions get replaced with user-provided values at render time.

## System Overview

```
User Draft (Russian text)
    │
    ▼
AI Processing (correct text, extract fields)
    │
    ▼
Requisites Merge (user > AI > auto > template)
    │
    ▼
DOCX Rendering (construct → valueRuns → Document → Buffer)
    │
    ▼
Final DOCX (placeholders replaced with values)
```

**Key principle:** Russian labels ARE the field keys. There is no separate English key namespace. `[Адресат]` in the template maps to the field `Адресат` in the docType config, which maps to the AI-extracted value for `Адресат`.

## Data Flow

### 1. Draft → AI Processing

The user sends a Russian text draft. The AI:
- Corrects spelling, grammar, and style
- Extracts document requisites (addressee, author position, etc.)
- Derives the document title (Тема)
- Returns structured JSON with `{ title, body, fields, changes }`

**Source:** `packages/backend/src/ai/processDraft.js`

### 2. AI Fields → Requisites Merge

The merge function combines field values from multiple sources in priority order:

```
User answer > AI-verified value > Auto value (date) > Template value
```

**Source:** `packages/backend/src/validation/requisites.js`

The merge produces:
- `values` — final field values with source metadata
- `pending` — fields the user still needs to fill
- `placeholders` — fields that will appear as `[Label]` in the DOCX

### 3. Requisites → DOCX Rendering

The render pipeline:
1. `construct(model)` selects the layout function for the `templateId:docType` combo
2. Layout functions call block functions (`orgHeader`, `addressee`, `dateNumber`, etc.)
3. Block functions use `valueRuns(model, key)` to render field values or placeholders
4. `renderDocx(model)` assembles the final `Document` object and packs it to a Buffer

**Source:** `packages/backend/src/docx/blocks.js`, `packages/backend/src/docx/render.js`

## Placeholder System

### Format

Placeholders use the format `[{label}]` where `{label}` is the Russian label string:

| Placeholder | Meaning |
|-------------|---------|
| `[Адресат]` | Addressee (who the document is addressed to) |
| `[Дата]` | Date (auto-filled, rarely empty) |
| `[Номер]` | Registry number (always a placeholder) |
| `[Тема]` | Document subject/title |
| `[Должность автора]` | Author's position |
| `[ФИО автора]` | Author's full name |

### How Placeholders Work

The `valueRuns(model, key)` function in `blocks.js` decides what to render:

```javascript
// From packages/backend/src/docx/blocks.js:30-42
export function valueRuns(model, key) {
  const val = model.values[key]?.value;
  if (val) {
    return [new TextRun(val)];           // ← value exists → render it
  }
  const label = model.values[key]?.label ?? key;
  return [new TextRun({
    text: `[${label}]`,                  // ← no value → render placeholder
    highlight: model.template.placeholder.highlight ?? undefined,  // yellow
  }]);
}
```

**Empty string `""` is treated as missing** — it falls through to the placeholder rendering. This matches the AI extraction behavior where empty fields come back as `""` not `null`.

### Registry Fields

Fields with `kind: "registry"` (e.g., `Номер`) are **always** placeholders. They never go through the AI extraction or auto-fill pipeline. The user must provide them manually or leave them empty for the DOCX to show `[Номер]`.

## Template + DocType Merge

The set of fields shown in the UI and rendered in the DOCX is the **union** of:
- `template.requiredFields` — array of Russian label strings
- `docType.fields` — array of field objects with `{ key, label, kind, required, ... }`

**Deduplication is by Russian label** (which equals the `key`). If both sources define `Адресат`, only one entry exists in the merged set.

```javascript
// From packages/backend/src/validation/requisites.js:29-47
const fieldsByLabel = new Map();

// Start with docType.fields (full metadata)
for (const field of docType.fields) {
  fieldsByLabel.set(field.key, field);
}

// Add requiredFields from template that aren't already in docType.fields
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
```

## Construct Methods — 8 Layout Combinations

There are 4 document types × 2 templates = 8 layout combinations. Each is a dedicated function that calls block functions in the correct order.

**Source:** `packages/backend/src/docx/blocks.js:265-365`

| Layout Key | Block Order |
|------------|-------------|
| `classic:memo` | orgHeader → addressee → docTitle → dateNumber → title → body → signature |
| `classic:report` | (same as classic:memo) |
| `classic:reference` | orgHeader → docTitle → dateNumber → title → body → signature |
| `classic:letter` | orgHeader → dateNumber → addressee → title → salutation → body → signature → executor |
| `modern:memo` | addressee → docTitle → dateNumber → title → body → signature |
| `modern:report` | (same as modern:memo) |
| `modern:reference` | docTitle → dateNumber → title → body → signature |
| `modern:letter` | dateNumber → addressee → title → salutation → body → signature → executor |

The layout registry is a simple lookup:

```javascript
const LAYOUTS = {
  'classic:memo': classicMemoLayout,
  'classic:report': classicReportLayout,
  // ... 6 more
};

export function construct(model) {
  const key = `${model.template.id}:${model.docType.id}`;
  return LAYOUTS[key](model);
}
```

## Rendering Pipeline — End to End

```
documentService.render(owner, id)
    │
    ├─ mergeRequisites({ docType, template, aiFields, title, userFields, today })
    │   → { values, pending, placeholders }
    │
    ├─ model = { docType, template, values, title, body }
    │
    ├─ renderDocx(model)
    │   │
    │   ├─ construct(model)          ← selects layout by templateId:docType
    │   │   │
    │   │   ├─ orgHeader(model)      ← template.organization from config
    │   │   ├─ addressee(model)      ← valueRuns(model, 'Адресат') or letter-specific fields
    │   │   ├─ docTitle(model)       ← docType.docTitle (null for letter)
    │   │   ├─ dateNumber(model)     ← valueRuns(model, 'Дата') + valueRuns(model, 'Номер')
    │   │   ├─ title(model)          ← version.title or valueRuns(model, 'Тема')
    │   │   ├─ salutation(model)     ← valueRuns(model, 'Обращение') — letter only
    │   │   ├─ body(model)           ← version.body paragraphs
    │   │   ├─ signature(model)      ← valueRuns(model, 'Должность автора/подписывающего')
    │   │   └─ executor(model)       ← valueRuns(model, 'Исполнитель') — letter only
    │   │
    │   └─ new Document({ ... })     ← docx library assembles the file
    │       └─ Packer.toBuffer()     ← returns Node.js Buffer
    │
    ├─ File caching (version_id + template_id + fields_hash)
    │
    └─ Return { file, fallback, placeholders }
```

## File Caching

DOCX files are cached by a hash of `(version_id, template_id, fields_hash)`. The `fieldsHash` is a SHA-256 of the sorted field values — so the same content with the same template produces the same file, avoiding redundant generation.

```javascript
// From packages/backend/src/core/documentService.js:531-534
const fieldsHash = crypto.createHash('sha256')
  .update(JSON.stringify(Object.entries(values).map(([key, item]) => [key, item?.value ?? null]).sort()))
  .digest('hex')
  .slice(0, 16);
```

## Key Files

| File | Responsibility |
|------|----------------|
| `packages/backend/config/doc-types/*.json` | Document type definitions (fields, layout, hints) |
| `packages/backend/config/templates/*.json` | Template definitions (font, spacing, blocks, requiredFields) |
| `packages/backend/src/validation/requisites.js` | Field merge logic (priority chain, pending detection) |
| `packages/backend/src/docx/blocks.js` | Block functions + layout combinations |
| `packages/backend/src/docx/render.js` | DOCX assembly (Document, Header, Footer, Packer) |
| `packages/backend/src/docx/units.js` | Unit conversions (mm, pt, halfPt, line → twips) |
| `packages/backend/src/core/documentService.js` | Document lifecycle + render orchestration |
| `packages/backend/src/ai/processDraft.js` | AI pipeline (call → parse → validate → ground) |
| `packages/backend/src/ai/prompt.js` | System prompt construction with placeholder awareness |
