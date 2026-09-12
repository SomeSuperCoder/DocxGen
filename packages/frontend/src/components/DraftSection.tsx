import { memo, useRef, useState } from 'react';
import { FileText, LockKeyhole, Mic, Square, Sparkles, Upload } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DOCUMENT_TYPES } from "@/lib/constants";
import { DOCUMENT_EXAMPLES } from "@/lib/examples";
import type { DocumentTypeId, TemplateId } from "@/types/document";

interface DraftSectionProps {
  text: string;
  documentType: DocumentTypeId;
  templateId: TemplateId;
  typeDescription: string;
  onTextChange: (value: string) => void;
  onTypeChange: (value: DocumentTypeId) => void;
  onTemplateChange: (value: TemplateId) => void;
  disabled: boolean;
  onAudioTranscribed?: (text: string) => void;
}
export const DraftSection = memo(function DraftSection({
  text,
  documentType,
  templateId,
  typeDescription,
  onTextChange,
  onTypeChange,
  onTemplateChange,
  disabled,
  onAudioTranscribed,
}: DraftSectionProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [recording, setRecording] = useState(false);
  const [audioBusy, setAudioBusy] = useState(false);
  const [audioError, setAudioError] = useState('');

  async function transcribe(blob: Blob) {
    setAudioBusy(true); setAudioError('');
    try {
      const response = await fetch('/api/audio/transcribe', { method: 'POST', headers: { 'X-Owner-Platform': 'web', 'X-Owner-Id': 'session', ...(import.meta.env.VITE_API_KEY ? { 'X-API-Key': import.meta.env.VITE_API_KEY } : {}) }, body: (() => { const form = new FormData(); form.append('file', blob, 'recording.webm'); return form; })() });
      const responseText = await response.text();
      let data: { ok?: boolean; text?: string; error?: { message?: string } };
      try { data = JSON.parse(responseText); }
      catch {
        if (response.status === 502) {
          throw new Error('Старый Vite-прокси не знает маршрут audio. Полностью остановите старый dev-процесс (Ctrl+C), затем запустите из корня: npm run dev.');
        }
        throw new Error(`Сервис распознавания вернул не JSON (HTTP ${response.status}).`);
      }
      if (!response.ok || !data.ok) throw new Error(data.error?.message ?? 'Не удалось распознать аудио');
      if (!data.text) throw new Error('Сервис не вернул распознанный текст');
      onAudioTranscribed?.(data.text);
    } catch (error) { setAudioError(error instanceof Error ? error.message : 'Ошибка распознавания'); }
    finally { setAudioBusy(false); }
  }

  async function toggleRecording() {
    if (recording) { recorderRef.current?.stop(); setRecording(false); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setAudioError('Запись аудио не поддерживается браузером'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream); chunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => { stream.getTracks().forEach((track) => track.stop()); void transcribe(new Blob(chunksRef.current, { type: recorder.mimeType })); };
      recorderRef.current = recorder; recorder.start(); setRecording(true); setAudioError('');
    } catch { setAudioError('Нет доступа к микрофону'); }
  }

  return (
    <div>
      <Card className="editor-card">
        <div className="editor-card-heading">
          <label htmlFor="draft-text">
            <FileText size={17} strokeWidth={1.6} aria-hidden="true" />
            Черновик
          </label>
          {!text && (
            <Button
              size="bare"
              variant="ghost"
              disabled={disabled}
              onClick={() =>
                onTextChange(DOCUMENT_EXAMPLES[documentType].draft)
              }
              className="text-[11px] text-primary"
            >
              <Sparkles size={13} aria-hidden="true" />
              Начать с примера
            </Button>
          )}
        </div>
        <Textarea
          id="draft-text"
          variant="bare"
          placeholder="Вставьте текст сюда. Можно как есть: со строчных, без запятых, обрывками. Поможем привести его в порядок."
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
          rows={9}
          className="editor-textarea"
          disabled={disabled}
          aria-describedby="draft-help"
        />
        <div className="editor-card-footer">
          <span id="draft-help">
            <LockKeyhole size={12} aria-hidden="true" />
            Отправляется после нажатия кнопки
          </span>
          <span>{text.length.toLocaleString("ru-RU")} симв.</span>
        </div>
      </Card>
      <div className="flex flex-wrap items-center gap-2 mt-3">
        <button type="button" onClick={() => void toggleRecording()} disabled={disabled || audioBusy} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50">
          {recording ? <Square size={16} /> : <Mic size={16} />} {recording ? 'Остановить запись' : 'Записать голосом'}
        </button>
        <button type="button" onClick={() => inputRef.current?.click()} disabled={disabled || audioBusy} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"><Upload size={16} /> Загрузить аудио</button>
        <input ref={inputRef} hidden type="file" accept="audio/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) void transcribe(file); event.target.value = ''; }} />
        {audioBusy && <span className="text-sm text-gray-500">Распознавание…</span>}
        {audioError && <span role="alert" className="text-sm text-red-600">{audioError}</span>}
      </div>
      <div className="draft-settings">
        <div>
          <label id="doc-type-label">Тип документа</label>
          <Select
            value={documentType}
            onValueChange={(value) => onTypeChange(value as DocumentTypeId)}
            disabled={disabled}
          >
            <SelectTrigger className="mt-2" aria-labelledby="doc-type-label">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DOCUMENT_TYPES.map((type) => (
                <SelectItem key={type.id} value={type.id}>
                  {type.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="setting-description">{typeDescription}</p>
        </div>
        <div>
          <label id="template-label">Шаблон оформления</label>
          <Select
            value={templateId}
            onValueChange={(value) => onTemplateChange(value as TemplateId)}
            disabled={disabled}
          >
            <SelectTrigger className="mt-2" aria-labelledby="template-label">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
               <SelectItem value="classic">Классический корпоративный</SelectItem>
               <SelectItem value="modern">Современный регламентный</SelectItem>
            </SelectContent>
          </Select>
          <p className="setting-description">
            {templateId === "classic"
              ? "Times New Roman, 14 пт. Полуторный интервал."
              : "Arial, 12 пт. Компактное оформление."}
          </p>
        </div>
      </div>
    </div>
  );
});
