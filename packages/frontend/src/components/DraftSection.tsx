import { memo, useRef } from 'react';
import { FileText, Loader2, LockKeyhole, Mic, Square, Sparkles, Upload } from "lucide-react";
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
import { formatDuration, MAX_RECORDING_SECONDS, useVoiceInput } from "@/lib/useVoiceInput";
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
  /** Текст, распознанный из записи или аудиофайла. */
  onAudioTranscribed: (text: string) => void;
  templates?: Array<{ id: string; name: string; description?: string }>;
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
  templates,
}: DraftSectionProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const voice = useVoiceInput(onAudioTranscribed);

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
      <div className="voice-input">
        <div className="voice-input-controls">
          {voice.phase === "recording" ? (
            <>
              <Button type="button" size="sm" onClick={voice.stop}>
                <Square size={14} fill="currentColor" aria-hidden="true" />
                Остановить запись
              </Button>
              <span className="voice-input-timer">
                <span className="voice-input-dot" aria-hidden="true" />
                <span>{formatDuration(voice.elapsed)}</span>
                <span className="voice-input-limit">из {formatDuration(MAX_RECORDING_SECONDS)}</span>
              </span>
            </>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void voice.start()}
              disabled={disabled || voice.phase !== "idle"}
            >
              <Mic size={15} aria-hidden="true" />
              Записать голосом
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={disabled || voice.phase !== "idle"}
          >
            <Upload size={15} aria-hidden="true" />
            Загрузить аудио
          </Button>
          <input
            ref={inputRef}
            hidden
            type="file"
            accept="audio/*"
            aria-label="Аудиофайл"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) voice.transcribeFile(file);
              event.target.value = "";
            }}
          />
        </div>
        {voice.phase === "transcribing" && (
          <p role="status" className="voice-input-status">
            <Loader2 size={13} className="animate-spin" aria-hidden="true" />
            Распознаём речь — текст появится в черновике
          </p>
        )}
        {voice.phase === "idle" && !voice.error && (
          <p className="voice-input-status">Надиктованный текст добавится в конец черновика</p>
        )}
        {voice.error && (
          <p role="alert" className="voice-input-status voice-input-error">
            {voice.error}
          </p>
        )}
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
              {(templates?.length ? templates : [
                { id: 'classic', name: 'Классический корпоративный', description: 'Times New Roman, 14 пт.' },
                { id: 'modern', name: 'Современный регламентный', description: 'Arial, 12 пт.' },
              ]).map((template) => <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="setting-description">
            {templates?.find((template) => template.id === templateId)?.description || (templateId === "classic"
              ? "Times New Roman, 14 пт. Полуторный интервал."
              : "Arial, 12 пт. Компактное оформление.")}
          </p>
        </div>
      </div>
    </div>
  );
});
