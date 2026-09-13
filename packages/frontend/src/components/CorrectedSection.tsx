import { memo } from 'react';

import { CheckCheck, PencilLine } from "lucide-react";
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { RequisitesForm } from './RequisitesForm';
import type { Requisites, DocTypeField } from '@/types/document';
import { ChangeReview } from './ChangeReview';
import { ResultExport } from './ResultExport';

interface CorrectedSectionProps {
  correctedText: string;
  requisites: Requisites;
  docTypeFields: DocTypeField[];
  onTextChange: (value: string) => void;
  onRequisiteChange: (field: string, value: string) => void;
  disabled: boolean;
  sourceText?: string;
  changes?: string[];
  sourceQuotes?: Record<string, string | null>;
}
export const CorrectedSection = memo(function CorrectedSection({
  correctedText,
  requisites,
  docTypeFields,
  onTextChange,
  onRequisiteChange,
  disabled,
  sourceText = '',
  changes = [],
  sourceQuotes = {},
}: CorrectedSectionProps) {
  if (!correctedText) return null;
  return (
    <div>
      <Card className="editor-card">
        <div className="editor-card-heading">
          <label htmlFor="corrected-text">
            <CheckCheck size={17} aria-hidden="true" />
            Исправленный текст
          </label>
          <span>Можно редактировать</span>
        </div>
        <Textarea
          id="corrected-text"
          variant="bare"
          value={correctedText}
          onChange={(event) => onTextChange(event.target.value)}
          rows={9}
          className="editor-textarea"
          disabled={disabled}
        />
        <div className="editor-card-footer">
          <span>
            <PencilLine size={12} aria-hidden="true" />
            Проверьте текст перед скачиванием
          </span>
          <span>{correctedText.length.toLocaleString("ru-RU")} симв.</span>
        </div>
      </Card>
      <ResultExport correctedText={correctedText} requisites={requisites} />
      <section
        className="requisites-panel"
        aria-labelledby="requisites-heading"
      >
        <h2 id="requisites-heading">Реквизиты</h2>
        <p>Дополните пустые поля или оставьте заметную пометку.</p>
        <RequisitesForm
          docTypeFields={docTypeFields}
          requisites={requisites}
          onChange={onRequisiteChange}
          disabled={disabled}
          sourceQuotes={sourceQuotes}
        />
      </section>
      <ChangeReview source={sourceText} corrected={correctedText} changes={changes} />
    </div>
  );
});
