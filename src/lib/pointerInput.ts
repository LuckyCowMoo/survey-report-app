import { useEffect, useState } from "react";

export type PointerInputMode = "fine" | "coarse";

function applyMode(mode: PointerInputMode) {
  document.documentElement.dataset.pointerInput = mode;
}

export function getPointerInputMode(): PointerInputMode {
  return document.documentElement.dataset.pointerInput === "fine"
    ? "fine"
    : "coarse";
}

/**
 * Tracks whether the user is primarily on mouse/keyboard (fine) or touch (coarse).
 * Sets `data-pointer-input` on <html> for CSS. Defaults to text-safe (coarse)
 * until a fine pointer / keyboard is detected, or when the device reports fine hover.
 */
export function usePointerInputMode() {
  useEffect(() => {
    const fineMq = window.matchMedia("(hover: hover) and (pointer: fine)");
    applyMode(fineMq.matches ? "fine" : "coarse");

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "touch") applyMode("coarse");
      else if (e.pointerType === "mouse" || e.pointerType === "pen") {
        applyMode("fine");
      }
    };

    const onKeyDown = () => applyMode("fine");

    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("keydown", onKeyDown, { passive: true });

    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);
}

/** Reactive pointer mode for UI copy (follows `data-pointer-input` on <html>). */
export function usePointerInputModeValue(): PointerInputMode {
  const [mode, setMode] = useState<PointerInputMode>(getPointerInputMode);

  useEffect(() => {
    const sync = () => setMode(getPointerInputMode());
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-pointer-input"]
    });
    return () => obs.disconnect();
  }, []);

  return mode;
}
