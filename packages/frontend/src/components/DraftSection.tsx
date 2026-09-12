import { memo } from "react";
import { FileText, LockKeyhole, Sparkles } from "lucide-react";
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
import { DOCUMENT_TYPES, TEMPLATES } from "@/lib/constants";
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
}: DraftSectionProps) {
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
              {TEMPLATES.map((template) => (
                <SelectItem key={template.id} value={template.id}>
                  {template.label}
                </SelectItem>
              ))}
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
