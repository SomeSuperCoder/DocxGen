import { memo, useMemo } from 'react';
import { Check, CircleDashed, Wand2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { analyzeDraft, applyAllStyleFixes, applyStyleFix, findStyleIssues } from '@/lib/draftTools';
import type { DocumentTypeId } from '@/types/document';

interface DraftAssistantProps {
  text: string;
  documentType: DocumentTypeId;
  onTextChange: (value: string) => void;
  disabled: boolean;
}

/**
 * Checks the draft in the browser while the user types: what the AI will be missing
 * and which colloquial words to replace. Nothing is sent anywhere.
 */
export const DraftAssistant = memo(function DraftAssistant({ text, documentType, onTextChange, disabled }: DraftAssistantProps) {
  const report = useMemo(() => analyzeDraft(text, documentType), [text, documentType]);
  const issues = useMemo(() => findStyleIssues(text), [text]);
  if (!text.trim()) return null;

  const ready = report.score === report.total;
  return (
    <Card className="mt-5 overflow-hidden" aria-labelledby="draft-readiness-heading">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <h2 id="draft-readiness-heading" className="text-sm font-medium">Готовность черновика</h2>
        <div className="flex items-center gap-3">
          <span className="flex gap-1" aria-hidden="true">
            {report.checks.map((check) => (
              <span key={check.id} className={`h-1.5 w-5 rounded-full transition-colors ${check.ok ? 'bg-primary' : 'bg-secondary'}`} />
            ))}
          </span>
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {ready ? 'Всё на месте' : `${report.score} из ${report.total}`}
          </span>
        </div>
      </div>
      <ul className="grid gap-x-6 gap-y-3 p-5 md:grid-cols-2">
        {report.checks.map((check) => (
          <li key={check.id} className="flex gap-2 text-sm">
            {check.ok
              ? <Check size={15} className="mt-0.5 shrink-0 text-emerald-600" aria-label="Есть" />
              : <CircleDashed size={15} className="mt-0.5 shrink-0 text-amber-600" aria-label="Не хватает" />}
            <span>
              <span className="font-medium">{check.label}</span>
              {!check.ok && <span className="block text-xs text-muted-foreground">{check.hint}</span>}
            </span>
          </li>
        ))}
      </ul>
      {issues.length > 0 && (
        <div className="border-t border-border px-5 py-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Wand2 size={13} aria-hidden="true" /> Разговорные слова
            </span>
            <button
              type="button"
              className="text-xs text-primary underline underline-offset-4 disabled:opacity-40"
              onClick={() => onTextChange(applyAllStyleFixes(text))}
              disabled={disabled}
            >
              Исправить все
            </button>
          </div>
          <ul className="flex flex-wrap gap-2">
            {issues.map((issue) => (
              <li key={`${issue.index}-${issue.word}`}>
                <button
                  type="button"
                  className="rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-secondary disabled:opacity-40"
                  onClick={() => onTextChange(applyStyleFix(text, issue))}
                  disabled={disabled}
                  title={issue.replacement ? `Заменить на «${issue.replacement}»` : 'Убрать из текста'}
                >
                  <span className="text-red-700 line-through decoration-red-700/60">{issue.word}</span>
                  <span className="mx-1.5 text-muted-foreground">→</span>
                  <span>{issue.replacement || 'убрать'}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
});
