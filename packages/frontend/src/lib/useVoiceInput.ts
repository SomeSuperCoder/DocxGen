import { useCallback, useEffect, useRef, useState } from "react";

/** Длинные записи Vosk распознаёт долго, а черновик служебного документа укладывается в пару минут. */
export const MAX_RECORDING_SECONDS = 5 * 60;

export type VoicePhase = "idle" | "recording" | "transcribing";

/** m:ss — как на диктофоне. */
export function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function extensionOf(mimeType: string) {
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mp4") || mimeType.includes("aac")) return "m4a";
  return "webm";
}

function microphoneError(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Нет доступа к микрофону. Разрешите доступ к микрофону для этого сайта в настройках браузера.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "Микрофон не найден. Подключите микрофон или загрузите аудиофайл.";
  }
  if (name === "NotReadableError") {
    return "Микрофон занят другим приложением. Закройте его и попробуйте снова.";
  }
  return "Не удалось включить микрофон. Попробуйте ещё раз или загрузите аудиофайл.";
}

/** Запись уходит в backend, как и остальные /api-запросы: владелец — cookie сессии. */
async function requestTranscript(audio: Blob, filename: string) {
  const form = new FormData();
  form.append("file", audio, filename);
  let response: Response;
  try {
    response = await fetch("/api/audio/transcribe", { method: "POST", body: form, credentials: "include" });
  } catch {
    throw new Error("Нет связи с сервером. Проверьте подключение и попробуйте снова.");
  }
  let data: { ok?: boolean; text?: string; error?: { message?: string } } = {};
  try {
    data = JSON.parse(await response.text());
  } catch {
    // Не JSON — страница ошибки прокси или сервера; ниже ответим по статусу.
  }
  if (!response.ok || !data.ok) {
    throw new Error(data.error?.message ?? `Сервис распознавания речи недоступен (HTTP ${response.status}).`);
  }
  const text = data.text?.trim();
  if (!text) throw new Error("Речь не распознана. Запишите ещё раз — чётче и ближе к микрофону.");
  return text;
}

/**
 * Голосовой ввод: запись с микрофона или файл → текст.
 * Микрофон освобождается, как только запись остановлена, — и при уходе со страницы тоже.
 */
export function useVoiceInput(onText: (text: string) => void) {
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const onTextRef = useRef(onText);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const mountedRef = useRef(false);

  useEffect(() => {
    onTextRef.current = onText;
  }, [onText]);

  const releaseMicrophone = useCallback(() => {
    window.clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const transcribe = useCallback(async (audio: Blob, filename: string) => {
    setPhase("transcribing");
    setError("");
    try {
      const text = await requestTranscript(audio, filename);
      if (mountedRef.current) onTextRef.current(text);
    } catch (err) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : "Не удалось распознать речь");
    } finally {
      if (mountedRef.current) setPhase("idle");
    }
  }, []);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }, []);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Этот браузер не умеет записывать звук. Загрузите аудиофайл.");
      return;
    }
    setError("");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      setError(microphoneError(err));
      return;
    }
    if (!mountedRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    recorder.onstop = () => {
      releaseMicrophone();
      recorderRef.current = null;
      if (!mountedRef.current) return;
      const audio = new Blob(chunks, { type: recorder.mimeType });
      if (!audio.size) {
        setPhase("idle");
        setError("Запись получилась пустой. Попробуйте ещё раз.");
        return;
      }
      void transcribe(audio, `recording.${extensionOf(recorder.mimeType)}`);
    };

    streamRef.current = stream;
    recorderRef.current = recorder;
    recorder.start();
    const startedAt = Date.now();
    setElapsed(0);
    setPhase("recording");
    timerRef.current = window.setInterval(() => {
      const seconds = Math.floor((Date.now() - startedAt) / 1000);
      setElapsed(seconds);
      if (seconds >= MAX_RECORDING_SECONDS && recorder.state !== "inactive") recorder.stop();
    }, 250);
  }, [releaseMicrophone, transcribe]);

  const transcribeFile = useCallback((file: File) => {
    void transcribe(file, file.name || "audio");
  }, [transcribe]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      releaseMicrophone();
    };
  }, [releaseMicrophone]);

  return { phase, elapsed, error, start, stop, transcribeFile };
}
