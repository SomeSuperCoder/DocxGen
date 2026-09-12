import { memo } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { CheckCheck, Sparkles } from "lucide-react";
interface StatusBarProps {
  status: string;
  isVisible: boolean;
  busy?: boolean;
}

export const StatusBar = memo(function StatusBar({
  status,
  isVisible,
  busy = false,
}: StatusBarProps) {
  const reduced = useReducedMotion();
  return (
    <AnimatePresence>
      {isVisible && !!status && (
        <motion.div
          role="status"
          aria-live="polite"
          initial={reduced ? false : { opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? {} : { opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.2 }}
          className="status-panel"
        >
          {busy ? (
            <Sparkles size={19} aria-hidden="true" />
          ) : (
            <CheckCheck size={19} aria-hidden="true" />
          )}
          <div className="status-copy">
            <span>{status}</span>
            {busy && (
              <small>
                Обычно 25-90 секунд. Можно оставаться на этой странице.
              </small>
            )}
          </div>
          {busy && <div className="processing-track" aria-hidden="true" />}
        </motion.div>
      )}
    </AnimatePresence>
  );
});
