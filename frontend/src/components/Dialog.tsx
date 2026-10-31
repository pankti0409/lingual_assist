import { X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { dialogVariants } from "@/lib/motion";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  /** Element to focus first; defaults to the first focusable element. */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  tone?: "default" | "danger";
}

/**
 * Modal dialog: traps Tab focus, closes on Escape, restores focus to the opener, and marks the
 * rest of the page inert while open.
 */
export function Dialog({ open, onClose, title, description, children, initialFocusRef, tone = "default" }: DialogProps) {
  const titleId = useId();
  const descId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement as HTMLElement | null;
    const root = document.getElementById("root");
    root?.setAttribute("inert", "");
    const t = requestAnimationFrame(() => {
      const target = initialFocusRef?.current ?? panelRef.current?.querySelector<HTMLElement>(FOCUSABLE) ?? panelRef.current;
      target?.focus();
    });
    return () => {
      cancelAnimationFrame(t);
      root?.removeAttribute("inert");
      const opener = openerRef.current;
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [open, initialFocusRef]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !panelRef.current) return;
    const items = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (!items.length) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="dialog-layer" onKeyDown={onKeyDown}>
          <motion.div
            className="dialog-scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            ref={panelRef}
            className={`dialog dialog--${tone}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={description ? descId : undefined}
            tabIndex={-1}
            variants={reduce ? undefined : dialogVariants}
            initial="hidden"
            animate="shown"
            exit="exit"
          >
            <div className="dialog__head">
              <h2 id={titleId} className="dialog__title">{title}</h2>
              <button type="button" className="icon-btn" onClick={onClose} aria-label="Close dialog">
                <X aria-hidden size={22} />
              </button>
            </div>
            {description && <div id={descId} className="dialog__desc">{description}</div>}
            <div className="dialog__body">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
