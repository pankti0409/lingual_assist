/** Central animation constants (seconds, for Motion). CSS mirrors live in tokens.css. */
import { useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { motionAllowed, usePreferences } from "@/state/preferences";

export const DUR = {
  press: 0.14, // 120–160 ms
  popover: 0.18, // 150–220 ms
  dialog: 0.26, // 220–300 ms
  route: 0.38, // 300–450 ms
  exit: 0.12, // fast exits
  story: 0.9, // marketing illustration transitions (max)
} as const;

export const EASE_OUT = [0.22, 1, 0.36, 1] as const;
export const EASE_IN = [0.55, 0, 1, 0.45] as const;

/** True when motion should be reduced: by the system setting or by the personal preference. */
export function useCalm(): boolean {
  const system = useReducedMotion();
  const { prefs } = usePreferences();
  return !motionAllowed(prefs.motion, system);
}

/** True when decorative motion should run (not reduced, document visible). */
export function useDecorativeMotion(): boolean {
  const calm = useCalm();
  const visible = usePageVisible();
  return !calm && visible;
}

/** Gentle press feedback for large interactive surfaces. */
export const press = { whileTap: { scale: 0.97 }, transition: { duration: 0.14 } } as const;

export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === "undefined" || !document.hidden);
  useEffect(() => {
    const on = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return visible;
}

/** Route-level enter animation. Exits are immediate so focus moves without waiting. */
export const routeVariants = {
  initial: { opacity: 0, y: 14 },
  enter: { opacity: 1, y: 0, transition: { duration: DUR.route, ease: EASE_OUT } },
};

export const dialogVariants = {
  hidden: { opacity: 0, scale: 0.97, y: 8 },
  shown: { opacity: 1, scale: 1, y: 0, transition: { duration: DUR.dialog, ease: EASE_OUT } },
  exit: { opacity: 0, scale: 0.98, transition: { duration: DUR.exit, ease: EASE_IN } },
};

export const popVariants = {
  hidden: { opacity: 0, y: 6 },
  shown: { opacity: 1, y: 0, transition: { duration: DUR.popover, ease: EASE_OUT } },
  exit: { opacity: 0, transition: { duration: DUR.exit } },
};
