import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Same type-in / erase motion as standard wording on the review screen:
 * 1.5s ease-in-out type, erase at 4× in reverse when replacing.
 */
export function useTextReveal() {
  const [revealDisplay, setRevealDisplay] = useState<string | null>(null);
  const timerRef = useRef(0);

  const cancelTextReveal = useCallback(() => {
    window.clearInterval(timerRef.current);
    setRevealDisplay(null);
  }, []);

  useEffect(() => () => window.clearInterval(timerRef.current), []);

  const triggerTextReveal = useCallback(
    (
      prevText: string,
      nextText: string,
      opts?: { replace?: boolean; eraseOnly?: boolean; onDone?: () => void }
    ) => {
      const prev = prevText;
      const next = nextText;
      const prevTrim = prev.trim();
      const nextTrim = next.trim();
      const replace = Boolean(opts?.replace);
      const eraseOnly = Boolean(opts?.eraseOnly);
      const onDone = opts?.onDone;

      if (!eraseOnly) {
        if (replace) {
          if (prevTrim === nextTrim) {
            onDone?.();
            return;
          }
        } else if (!nextTrim) {
          onDone?.();
          return;
        }
      }

      window.clearInterval(timerRef.current);

      const typeMs = 1500;
      const eraseMs = typeMs / 4;
      const tickMs = 16;
      const easeInOut = (t: number) =>
        t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

      const finish = () => {
        window.clearInterval(timerRef.current);
        setRevealDisplay(null);
        onDone?.();
      };

      const startType = () => {
        if (!next.length) {
          finish();
          return;
        }
        const startedAt = performance.now();
        setRevealDisplay("");
        timerRef.current = window.setInterval(() => {
          const t = Math.min(1, (performance.now() - startedAt) / typeMs);
          const shown = Math.floor(easeInOut(t) * next.length);
          if (t >= 1) {
            finish();
            return;
          }
          setRevealDisplay(next.slice(0, shown));
        }, tickMs);
      };

      const startErase = () => {
        const startedAt = performance.now();
        setRevealDisplay(prev);
        timerRef.current = window.setInterval(() => {
          const t = Math.min(1, (performance.now() - startedAt) / eraseMs);
          const remaining = Math.ceil((1 - easeInOut(t)) * prev.length);
          if (t >= 1) {
            window.clearInterval(timerRef.current);
            if (eraseOnly) {
              finish();
              return;
            }
            startType();
            return;
          }
          setRevealDisplay(prev.slice(0, remaining));
        }, tickMs);
      };

      if ((replace || eraseOnly) && prevTrim.length > 0) startErase();
      else if (eraseOnly) finish();
      else startType();
    },
    []
  );

  return { revealDisplay, triggerTextReveal, cancelTextReveal };
}
