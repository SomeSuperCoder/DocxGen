import { memo } from 'react';
import { cn } from '@/lib/utils';
import type { Requisites, DocTypeField } from '@/types/document';

interface RequisitesFormProps {
  docTypeFields: DocTypeField[];
  requisites: Requisites;
  onChange: (field: string, value: string) => void;
  disabled: boolean;
}

/** Empty fields use the same highlight color as placeholders in the preview. */
export const RequisitesForm = memo(function RequisitesForm({
  docTypeFields,
  requisites,
  onChange,
  disabled,
}: RequisitesFormProps) {
  // Show loading state when no fields are available
  if (docTypeFields.length === 0) {
    return (
      <div className="grid grid-cols-1 gap-x-10 gap-y-2 md:grid-cols-2">
        <div className="pt-3.5 text-sm text-muted-foreground">
          Загрузка полей…
        </div>
      </div>
    );
  }

  // Filter out 'auto' (filled automatically) and 'registry' (placeholder, not user-editable) fields
  const visibleFields = docTypeFields.filter((field) => field.kind !== 'auto' && field.kind !== 'registry');

  return (
    <div className="grid grid-cols-1 gap-x-10 gap-y-2 md:grid-cols-2">
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
            <input
              value={requisites[field.key] || ''}
              onChange={(e) => onChange(field.key, e.target.value)}
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
          </label>
        );
      })}
    </div>
  );
});
