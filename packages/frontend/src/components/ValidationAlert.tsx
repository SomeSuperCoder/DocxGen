import { memo } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import type { MissingField } from "@/types/document";

interface ValidationAlertProps {
  missingFields: MissingField[];
  warnings: string[];
}

/**
 * Предупреждение живёт на волосяной линии, без плашки: это не ошибка, а
 * замечание по дороге. Пустые реквизиты названы поимённо, чтобы не гадать.
 */
export const ValidationAlert = memo(function ValidationAlert({
  missingFields,
  warnings,
}: ValidationAlertProps) {
  const prefersReduced = useReducedMotion();
  const show = missingFields.length > 0 || warnings.length > 0;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="validation-alert"
          initial={prefersReduced ? false : { opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={prefersReduced ? {} : { opacity: 0, y: -6 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          role="status"
          className="mt-5 rounded-lg border border-warning/25 bg-highlight/20 p-5"
        >
          <span className="label-caps text-warning">Проверьте реквизиты</span>
          {missingFields.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {missingFields.map((field) => (
                <li key={field.field} className="text-base leading-7">
                  <span className="font-medium">{field.label}</span>
                  <span className="text-muted-foreground">
                    : заполните или оставьте понятную отметку
                  </span>
                </li>
              ))}
            </ul>
          )}
          {warnings.map((warning) => (
            <p
              key={warning}
              className="mt-2 text-base leading-7 text-muted-foreground"
            >
              {warning}
            </p>
          ))}
          <p className="mt-3 text-sm text-muted-foreground">
            Незаполненное попадёт в документ жёлтой пометкой. Его будет легко
            найти и дополнить.
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  );
});
