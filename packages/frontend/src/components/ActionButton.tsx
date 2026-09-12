import { memo } from "react";
import { ArrowRight, Download, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
interface ActionButtonProps {
  step: 1 | 2;
  processing: boolean;
  generating: boolean;
  onClick: () => void;
  disabled: boolean;
}

export const ActionButton = memo(function ActionButton({
  step,
  processing,
  generating,
  onClick,
  disabled,
}: ActionButtonProps) {
  const busy = processing || generating;
  return (
    <Button
      onClick={onClick}
      disabled={disabled}
      aria-busy={busy}
      className="w-full sm:w-auto text-xs sm:text-[13px]"
    >
      {step === 1 ? (
        <>
          <Sparkles size={16} aria-hidden="true" />
          {processing ? "Обработка…" : "Обработать черновик"}
          {!processing && <ArrowRight size={16} aria-hidden="true" />}
        </>
      ) : (
        <>
          <Download size={16} aria-hidden="true" />
          {generating ? "Формирование…" : "Сформировать и скачать DOCX"}
        </>
      )}
    </Button>
  );
});
