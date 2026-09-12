import { Fragment, memo } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface StepIndicatorProps {
  currentStep: 1 | 2;
  complete?: boolean;
  className?: string;
}
const steps = [
  { num: 1, label: "Черновик" },
  { num: 2, label: "Результат" },
  { num: 3, label: "Готовый файл" },
];

export const StepIndicator = memo(function StepIndicator({
  currentStep,
  complete = false,
  className,
}: StepIndicatorProps) {
  const activeStep = complete ? 3 : currentStep;
  return (
    <ol
      className={cn("workflow-steps", className)}
      aria-label="Этапы документа"
    >
      {steps.map((step, index) => (
        <Fragment key={step.num}>
          {index > 0 && <li className="workflow-line" aria-hidden="true" />}
          <li
            className={cn("workflow-step", activeStep > step.num && "is-done")}
            aria-current={activeStep === step.num ? "step" : undefined}
          >
            <span className="workflow-number">
              {activeStep > step.num ? (
                <Check size={13} aria-hidden="true" />
              ) : (
                step.num
              )}
            </span>
            <span>{step.label}</span>
          </li>
        </Fragment>
      ))}
    </ol>
  );
});
