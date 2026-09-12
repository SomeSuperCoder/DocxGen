import { memo } from "react";
import { FIELD_LABELS, FIELD_ORDER } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { Requisites } from "@/types/document";

interface RequisitesFormProps {
  fields: string[];
  requisites: Requisites;
  visibleFields: string[];
  onChange: (field: string, value: string) => void;
  disabled: boolean;
}

/** Empty fields use the same highlight color as placeholders in the preview. */
export const RequisitesForm = memo(function RequisitesForm({
  fields,
  requisites,
  onChange,
  disabled,
}: RequisitesFormProps) {
  const orderedFields = FIELD_ORDER.filter((f) => fields.includes(f));

  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-2 md:grid-cols-2">
      {orderedFields.map((field) => {
        const empty = !requisites[field];
        return (
          <label key={field} className="block pt-3.5">
            <span className="mb-2 block text-xs text-muted-foreground">
              {FIELD_LABELS[field]}
            </span>
            <input
              value={requisites[field] || ""}
              onChange={(e) => onChange(field, e.target.value)}
              placeholder={`[${FIELD_LABELS[field]}]`}
              disabled={disabled}
              className={cn(
                "w-full rounded-md border bg-transparent px-3 py-2.5 text-base md:text-sm text-foreground transition-colors",
                "placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                "disabled:cursor-not-allowed disabled:opacity-50",
                empty ? "border-warning/50 bg-highlight/15" : "border-input",
              )}
            />
          </label>
        );
      })}
    </div>
  );
});
