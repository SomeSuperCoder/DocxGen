import { memo, useState } from 'react';
import { Mic } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Requisites, DocTypeField } from '@/types/document';
import { SourceQuote } from './ChangeReview';

interface RequisitesFormProps {
  docTypeFields: DocTypeField[];
  requisites: Requisites;
  onChange: (field: string, value: string) => void;
  disabled: boolean;
  sourceQuotes?: Record<string, string | null>;
}

/** Empty fields use the same highlight color as placeholders in the preview. */
export const RequisitesForm = memo(function RequisitesForm({
  docTypeFields,
  requisites,
  onChange,
  disabled,
  sourceQuotes = {},
}: RequisitesFormProps) {
  const [listening, setListening] = useState<string | null>(null);
  const [directoryHints, setDirectoryHints] = useState<Record<string, string>>({});
  const dictate = (field: string) => {
    const Speech = (window as unknown as { SpeechRecognition?: new () => { lang: string; start: () => void; onresult: (event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onend: () => void; onerror: () => void } }).SpeechRecognition;
    if (!Speech) return;
    const recognition = new Speech();
    recognition.lang = 'ru-RU'; setListening(field);
    recognition.onresult = (event) => { const transcript = event.results[0]?.[0]?.transcript || ''; if (transcript) onChange(field, transcript); };
    recognition.onend = () => setListening(null); recognition.onerror = () => setListening(null); recognition.start();
  };
  const lookupDirectory = async (field: DocTypeField, value: string) => {
    if (!value.trim() || !/(адресат|подпис|автор|исполн|фио)/i.test(field.label)) return;
    const response = await fetch(`/api/directory/resolve?query=${encodeURIComponent(value)}`, { credentials: 'include' }).catch(() => null);
    if (!response?.ok) return;
    const data = await response.json() as { suggestion?: string | null };
    if (data.suggestion) setDirectoryHints((current) => ({ ...current, [field.key]: data.suggestion! }));
  };
  // Show loading state when no fields are available
  if (docTypeFields.length === 0) {
    return (
    <div className="requisites-panel grid grid-cols-1 gap-x-10 gap-y-2 md:grid-cols-2">
        <div className="pt-3.5 text-sm text-muted-foreground">
          Загрузка полей…
        </div>
      </div>
    );
  }

  // Filter out 'auto' (filled automatically) and 'registry' (placeholder, not user-editable) fields
  const visibleFields = docTypeFields.filter((field) => field.kind !== 'auto' && field.kind !== 'registry');

  return (
    <div className="requisites-panel grid grid-cols-1 gap-x-10 gap-y-2 md:grid-cols-2">
      {visibleFields.map((field) => {
        const empty = !requisites[field.key];
        const isEditable = field.kind === 'extract' || field.kind === 'derived';
        const placeholder = field.example || field.label;

        return (
          <label key={field.key} className="block pt-3.5">
            <span className="block text-sm text-muted-foreground">
              {field.label}
              {field.required && <span className="ml-0.5 text-red-500">*</span>}
            </span>
            <div className="flex items-end gap-2">
              <input
                value={requisites[field.key] || ''}
                onChange={(e) => onChange(field.key, e.target.value)}
                onBlur={(e) => void lookupDirectory(field, e.target.value)}
                placeholder={placeholder}
                disabled={disabled || !isEditable}
                readOnly={!isEditable}
                className={cn(
                  'w-full border-0 border-b bg-transparent px-0 py-2 text-base text-foreground transition-colors',
                'placeholder:text-muted-foreground/60 focus:outline-none focus-visible:outline-none focus-visible:border-primary',
                'disabled:cursor-not-allowed disabled:opacity-50',
                'read-only:cursor-default',
                  empty ? 'border-warning' : 'border-border',
                )}
              />
              {isEditable && <button type="button" title="Надиктовать реквизит" aria-label={`Надиктовать: ${field.label}`} onClick={() => dictate(field.key)} disabled={disabled} className={cn('mb-1 rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-primary', listening === field.key && 'text-primary')}><Mic size={14} /></button>}
            </div>
            <SourceQuote quote={sourceQuotes[field.key]} />
            {directoryHints[field.key] && <button type="button" className="mt-1 text-left text-xs text-primary underline" onClick={() => { onChange(field.key, directoryHints[field.key]); setDirectoryHints((current) => { const next = { ...current }; delete next[field.key]; return next; }); }}>Подставить из справочника: {directoryHints[field.key]}</button>}
          </label>
        );
      })}
    </div>
  );
});
