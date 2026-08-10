import { useEffect } from "react";

export type PointerInputMode = "fine" | "coarse";

function applyMode(mode: PointerInputMode) {
  document.documentElement.dataset.pointerInput = mode;
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
