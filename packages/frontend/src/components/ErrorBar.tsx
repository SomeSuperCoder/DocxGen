import { memo } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";

interface ErrorBarProps {
  error: string;
  isVisible: boolean;
}

/**
 * Отказ: кирпич вместо алого, и главным сообщением — что черновик цел.
 * Терять набранный текст страшнее, чем не получить файл с первого раза.
 */
export const ErrorBar = memo(function ErrorBar({
  error,
  isVisible,
}: ErrorBarProps) {
  const prefersReduced = useReducedMotion();
  const show = isVisible && !!error;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="error-bar"
          initial={prefersReduced ? false : { opacity: 0, scale: 0.99 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={prefersReduced ? {} : { opacity: 0, scale: 0.99 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-5"
        >
          <span className="label-caps text-destructive">Не получилось</span>
          <p className="mt-3 text-base leading-7">{error}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Черновик, тип и шаблон сохранены. Повторите действие.
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  );
});
