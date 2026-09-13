# Audio service

Speech recognition (Vosk) runs in a separate process on `127.0.0.1:3005`
(`AUDIO_SERVICE_PORT`). Two clients use it:

- the web app — the microphone and file upload in the draft editor post the
  audio to the backend (`POST /api/audio/transcribe`). The backend takes the
  owner from the session cookie, adds `API_KEY` and forwards the file, so the
  browser never talks to port 3005 and never sees the key. The recognized text
  is appended to the end of the draft; a recording stops by itself after 5
  minutes;
- the MAX and VK bots — a voice message (VK `audio_message`) or an audio file
  (MAX `audio`, or a MAX `file` named `*.m4a`, `*.mp3`, `*.ogg`, `*.wav`…) is
  downloaded by the backend and sent to the same endpoint; the transcript is
  echoed to the user and handled like a typed draft.

  **MAX does not deliver voice messages to bots.** Checked on 13.09.2026: the
  Bot API sends `message_created` with only `timestamp`, `user_locale` and
  `update_type` — no `message`, no chat, no sender — and `GET /messages` does
  not list the voice message either. The bot cannot even reply, so such updates
  are skipped (logged as «сообщение без содержимого») and the MAX texts do not
  offer voice; `/help` in MAX points to the web app and the VK bot instead.

  Voice is accepted only while the draft is collected (before «Создать
  документ» and at step 1). The AI corrects the draft afterwards, while a
  requisite answer or the edited text would reach the document as recognized:
  lowercase, without punctuation, numbers in words. On the other steps the bot
  does not call Vosk and replies that only the draft can be sent by voice,
  repeating the keyboard of the step; during processing it answers «Обработка
  ещё идёт».

  In polling mode (MAX polling, VK long poll) the poll loop does not wait for
  an update to be handled, like the webhook and callback modes: recognizing one
  user's voice message does not delay the others. Messages of one conversation
  are still handled in order by the dispatcher's per-conversation queue.

Any format ffmpeg reads is accepted: WebM/Opus (Chrome, Firefox), MP4/M4A
(Safari, iPhone, phone recorders), OGG/Opus (VK and MAX voice messages), MP3,
WAV. The file is written to a temporary file before decoding: MP4 keeps its
index at the end, which ffmpeg cannot reach through a pipe.

Run the whole development stack from the repository root:

```bash
npm install
npm run dev
```

The `dev` script starts the backend with in-process bot adapters, the audio
service and the frontend. Vite proxies every `/api` request, including
`/api/audio/transcribe`, to the backend on `PORT`.

## Setup (Windows, Linux, macOS)

The service needs:

- `ffmpeg` in `PATH` (or `FFMPEG_BIN`) — Windows: `scoop install ffmpeg`,
  Ubuntu: `apt install ffmpeg`, macOS: `brew install ffmpeg`;
- Python 3 — used once to create an isolated environment;
- the Russian model at `VOSK_MODEL_PATH` (default
  `./models/vosk-model-small-ru-0.22`, relative to `packages/backend`).

The setup script checks ffmpeg, creates `packages/backend/.venv-audio`, installs
`vosk` into it and downloads the model if it is missing:

```bash
cd packages/backend
npm run setup:audio
```

Use `SETUP_PYTHON` to pick the Python that creates the environment. The
service then uses the interpreter from the environment: `VOSK_PYTHON` left
empty means `.venv-audio/Scripts/python.exe` on Windows and
`.venv-audio/bin/python` elsewhere. The Python sidecar is used because the
Node `vosk` package depends on `ffi-napi`, which does not build with Node 24.

If the model zip is already downloaded, unpack it so that
`packages/backend/models/vosk-model-small-ru-0.22/am/final.mdl` exists; the
script then skips the download.

## Check

```bash
curl http://127.0.0.1:3005/health
```

It must return `{"ok":true}`. If it does not answer, the web app shows
«Сервис распознавания речи недоступен» (`STT_UNAVAILABLE`, HTTP 503) and bots
reply that the voice message was not recognized; restart the stack. If the
model or Vosk is missing, the service still starts and answers
`/api/audio/transcribe` with `STT_FAILED` and the exact cause. If the Vosk
process exits, the next request starts it again.

Every request is logged by the audio service: `речь распознана` with the size,
duration and processing time, or `речь не распознана` with the error code and
the ffmpeg output in `detail`.
