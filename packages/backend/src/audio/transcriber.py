#!/usr/bin/env python3
"""Small Vosk sidecar used when the Node ffi binding cannot compile."""
import json
import os
import sys


def reply(payload):
    # ASCII-only JSON (\\uXXXX): a piped stdout on Windows is cp1252 and cannot encode Cyrillic.
    # Node's JSON.parse restores the text, so the answer does not depend on the console encoding.
    print(json.dumps(payload), flush=True)


try:
    from vosk import Model, KaldiRecognizer
except Exception as exc:
    reply({"error": f"Vosk не установлен: {exc}"})
    sys.exit(1)

model = Model(os.environ["VOSK_MODEL_PATH"])
for line in sys.stdin:
    try:
        request = json.loads(line)
        recognizer = KaldiRecognizer(model, 16000)
        recognizer.AcceptWaveform(bytes.fromhex(request["pcm"]))
        result = json.loads(recognizer.FinalResult())
        reply({"text": result.get("text", "")})
    except Exception as exc:
        reply({"error": str(exc)})
