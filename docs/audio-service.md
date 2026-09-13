# Audio service

Speech recognition (Vosk) runs in a separate process on `127.0.0.1:3005`
(`AUDIO_SERVICE_PORT`). Two clients use it:

- the web app — the microphone and file upload in the draft editor send audio
  through the Vite proxy (`/api/audio`);
- the MAX and VK bots — a voice message is downloaded by the backend and sent to
  the same endpoint; the transcript is echoed to the user and handled like a
  typed draft.

Run the whole development stack from the repository root:

```bash
npm install
npm run dev
```

The `dev` script starts the backend with in-process bot adapters, the audio
service and the frontend. The frontend must be started with its working
directory set to `packages/frontend`; otherwise Vite may not load
`packages/frontend/vite.config.ts` and `/api/audio` becomes a local Vite 404.

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

It must return `{"ok":true}`. A browser-side HTTP 502 means that nothing is
listening on port 3005 (usually an old dev process); restart the stack. If the
model or Vosk is missing, the service still starts and answers
`/api/audio/transcribe` with `STT_FAILED` and the exact cause.
