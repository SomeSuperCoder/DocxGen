# REST API Documentation — «Документ за 3 шага»

Base URL: `http://localhost:3000`

All responses are JSON. Errors follow the format: `{ error: { code: string, message: string } }`.

---

## Authentication

Ownership is enforced via cookies. The server creates a `sid` cookie on first request (httpOnly, sameSite lax, 1 year). All document operations are scoped to this cookie — different cookies = different owners.

**No login required.** The cookie IS the identity.

Trusted external integrations may send `X-API-Key` together with
`X-Owner-Platform` (`max`, `vk` or `local`) and `X-Owner-Id`. These headers are
accepted only when the API key matches `API_KEY`; browser sessions should omit
them.

---

## Endpoints

### Health Check

```
GET /health
```

**Response (200):**
```json
{
  "ok": true,
  "ai": { "provider": "mock", "reachable": true },
  "templates": 2
}
```

---

### Catalog

```
GET /api/catalog
```

Returns available document types and templates.

**Response (200):**
```json
{
  "docTypes": [
    { "id": "memo", "name": "Служебная записка", "hint": "...", "fields": [...] }
  ],
  "templates": [
    { "id": "classic", "name": "Classic", "description": "...", "preview": null }
  ]
}
```

---

### Create Document

```
POST /api/documents
```

**Body (optional fields):**
```json
{
  "sourceText": "Текст черновика",
  "docType": "memo",
  "templateId": "classic"
}
```

**Response (201):**
```json
{
  "id": "uuid",
  "status": "draft",
  "docType": "memo",
  "templateId": "classic",
  "sourceText": "Текст черновика",
  "draftVersion": 1,
  "userFields": {},
  "version": null,
  "pending": [],
  "placeholders": [],
  "error": null,
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

**Curl:**
```bash
curl -X POST http://localhost:3000/api/documents \
  -H "Content-Type: application/json" \
  -d '{"sourceText": "Служебная записка", "docType": "memo", "templateId": "classic"}'
```

---

### List Documents

```
GET /api/documents?status=draft&limit=20&offset=0
```

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `status` | string | all | Filter by status: `draft`, `processing`, `processed`, `ai_failed` |
| `limit` | number | 20 | Max results (1-100) |
| `offset` | number | 0 | Pagination offset |

**Response (200):**
```json
{
  "documents": [...],
  "total": 42
}
```

**Curl:**
```bash
curl http://localhost:3000/api/documents?status=draft&limit=10
```

---

### Get Document

```
GET /api/documents/:id
```

**Response (200):** DocumentView object.

**Curl:**
```bash
curl http://localhost:3000/api/documents/{id}
```

---

### Update Document

```
PATCH /api/documents/:id
```

Update source text, document type, or template. Only provided fields are changed.

**Body (optional):**
```json
{
  "sourceText": "Updated text",
  "docType": "report",
  "templateId": "modern"
}
```

**Response (200):** Updated DocumentView.

**Curl:**
```bash
curl -X PATCH http://localhost:3000/api/documents/{id} \
  -H "Content-Type: application/json" \
  -d '{"docType": "report"}'
```

---

### Delete Document

```
DELETE /api/documents/:id
```

**Response (204):** No body.

**Curl:**
```bash
curl -X DELETE http://localhost:3000/api/documents/{id}
```

---

### Start Processing

```
POST /api/documents/:id/process
```

Starts AI processing. Requires: `sourceText`, `docType`, `templateId`.

**Response (202):**
```json
{
  "jobId": "uuid",
  "reused": false
}
```

**Curl:**
```bash
curl -X POST http://localhost:3000/api/documents/{id}/process
```

### Retry after AI failure

```
POST /api/documents/:id/retry
```

Queues a new attempt only when the document is in `ai_failed`. It does not reuse
the failed `/process` idempotency key.

**Response (202):**
```json
{ "jobId": "uuid", "reused": false }
```

---

### Set Fields

```
PUT /api/documents/:id/fields
```

Set field values from body key/value pairs. Values are truncated to 300 chars.

**Body:**
```json
{
  "author": "Иванов И.И.",
  "department": "IT",
  "date": "01.01.2024"
}
```

**Response (200):** Updated DocumentView.

**Curl:**
```bash
curl -X PUT http://localhost:3000/api/documents/{id}/fields \
  -H "Content-Type: application/json" \
  -d '{"author": "Иванов И.И.", "department": "IT"}'
```

---

### Set Manual Text

```
PUT /api/documents/:id/text
```

Manually set document title and body paragraphs. Marks document as `processed`.

**Body:**
```json
{
  "title": "Заголовок документа",
  "body": ["Абзац 1", "Абзац 2", "Абзац 3"]
}
```

**Response (200):** Updated DocumentView with `version.kind = 'manual'`.

**Curl:**
```bash
curl -X PUT http://localhost:3000/api/documents/{id}/text \
  -H "Content-Type: application/json" \
  -d '{"title": "Заголовок", "body": ["Параграф 1"]}'
```

---

### Render Document

```
POST /api/documents/:id/render
```

Renders document to DOCX. Requires: processed version with matching draft version.

**Response (200):**
```json
{
  "fileId": "uuid",
  "downloadUrl": "/api/files/{fileId}",
  "filename": "Служебная записка_2024-01-01_uuid.docx",
  "placeholders": [],
  "fallback": null
}
```

**Curl:**
```bash
curl -X POST http://localhost:3000/api/documents/{id}/render
```

---

### Download File

```
GET /api/files/:fileId
```

Downloads the rendered DOCX file.

**Response (200):**
- Content-Type: `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
- Content-Disposition: `attachment; filename="...docx"`

**Curl:**
```bash
curl -O http://localhost:3000/api/files/{fileId}
```

---

### Processing Log

```
GET /api/documents/:id/log
```

Returns processing log entries for a document.

**Response (200):**
```json
{
  "logs": [
    {
      "id": 1,
      "jobId": "uuid",
      "stage": "prompt",
      "data": { "prompt": "..." },
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

**Curl:**
```bash
curl http://localhost:3000/api/documents/{id}/log
```

---

### Transcribe Audio

```
POST /api/audio/transcribe
```

Recognizes Russian speech in an audio file (the web microphone and «Загрузить аудио»).
The request is `multipart/form-data` with the field `file`: WebM/Opus, MP4/M4A, OGG,
MP3 or WAV, up to 25 MB. The backend forwards it to the audio service (Vosk) on behalf
of the session owner; see [audio-service.md](audio-service.md).

**Response (200):**
```json
{
  "ok": true,
  "text": "прошу выделить ноутбук для нового сотрудника",
  "duration": 3.4
}
```

`duration` is the length of the audio in seconds. Errors: `AUDIO_INVALID` (400) — no
file or an unreadable file; `STT_FAILED` (502) — no speech recognized;
`STT_UNAVAILABLE` (503) — the audio service is not running.

**Curl:**
```bash
curl -X POST http://localhost:3000/api/audio/transcribe -F "file=@voice.m4a"
```

---

### Template Previews

```
GET /templates/previews/:file
```

Serves static preview images for templates.

**Response (200):** Image file (PNG/JPEG).

**Curl:**
curl http://localhost:3000/templates/previews/classic.png

---

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `NOT_FOUND` | 404 | Document or resource not found |
| `FORBIDDEN` | 403 | Access denied (wrong cookie) |
| `BUSY` | 409 | Document is being processed |
| `VALIDATION_ERROR` | 400 | Invalid input (missing type, template, etc.) |
| `DRAFT_EMPTY` | 400 | No draft text |
| `DRAFT_TOO_LONG` | 400 | Draft exceeds 20,000 characters |
| `NOT_READY` | 409 | No processed version available |
| `UNKNOWN_TYPE` | 400 | Invalid document type ID |
| `UNKNOWN_TEMPLATE` | 400 | Invalid template ID |
| `AUDIO_INVALID` | 400 | No audio file, or the file cannot be read |
| `STT_FAILED` | 502 | Speech was not recognized |
| `STT_UNAVAILABLE` | 503 | The audio service is not running |
| `RATE_LIMITED` | 429 | Too many requests (30/min per IP) |
| `INTERNAL` | 500 | Server error |

---

## Rate Limiting

Mutating routes (POST/PUT/PATCH/DELETE) are limited to **30 requests per minute per IP**.

Headers included in every response:
- `X-RateLimit-Limit`: Max requests per window
- `X-RateLimit-Remaining`: Requests left in current window
- `X-RateLimit-Reset`: Unix timestamp when the window resets

---

## Document Status Flow

```
draft → processing → processed
                    → ai_failed → processing (retry)
```

- `draft`: Initial state, can be edited
- `processing`: AI is working on it (locked for editing)
- `processed`: Version available, can render
- `ai_failed`: AI processing failed, can retry

---

## Curl Examples

### Complete flow: create → process → render → download

```bash
# 1. Create document
DOC=$(curl -s -X POST http://localhost:3000/api/documents \
  -H "Content-Type: application/json" \
  -d '{"sourceText": "Служебная записка о закупке", "docType": "memo", "templateId": "classic"}')
DOC_ID=$(echo $DOC | jq -r '.id')

# 2. Process
curl -s -X POST http://localhost:3000/api/documents/$DOC_ID/process | jq

# 3. Set fields (after processing completes)
curl -s -X PUT http://localhost:3000/api/documents/$DOC_ID/fields \
  -H "Content-Type: application/json" \
  -d '{"author": "Иванов И.И."}' | jq

# 4. Render
RENDER=$(curl -s -X POST http://localhost:3000/api/documents/$DOC_ID/render)
FILE_URL=$(echo $RENDER | jq -r '.downloadUrl')

# 5. Download
curl -O http://localhost:3000$FILE_URL
```
