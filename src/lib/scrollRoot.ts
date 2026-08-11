import { matchesStudioLayout } from "./studioLayout";

/** Desktop aside: left column is the scroll root; otherwise the window. */
export function getScrollRoot(): HTMLElement | Window {
  if (typeof window === "undefined") return window;
  if (matchesStudioLayout()) {
    const el = document.querySelector<HTMLElement>(".app.app-aside .content");
    if (el) return el;
  }
  return window;
}

export function readScrollTop(root: HTMLElement | Window): number {
  return root instanceof Window ? window.scrollY : root.scrollTop;
}

export function writeScrollTop(root: HTMLElement | Window, top: number) {
  if (root instanceof Window) window.scrollTo(0, top);
  else root.scrollTop = top;
}

let programmaticUntil = 0;
let programmaticRaf = 0;

/** True while a pip-driven (or other) animated scroll owns the scrollport. */
export function isProgrammaticScroll(): boolean {
  return performance.now() < programmaticUntil;
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/**
 * Smooth-scroll so `el` sits near the vertical centre of the review scrollport.
 * Continues to completion even if the pointer leaves the control that started it;
 * a newer call replaces the previous animation.
 */
export function scrollElementIntoViewCentered(
  el: HTMLElement,
  durationMs = 480
) {
  const root = getScrollRoot();
  const rootBox =
    root instanceof Window
      ? { top: 0, height: window.innerHeight }
      : root.getBoundingClientRect();
  const elBox = el.getBoundingClientRect();
  const current = readScrollTop(root);
  const elTopInContent = elBox.top - rootBox.top + current;
  const target =
    elTopInContent - (rootBox.height - elBox.height) / 2;
  const maxScroll =
    root instanceof Window
      ? Math.max(
          0,
          document.documentElement.scrollHeight - window.innerHeight
        )
      : Math.max(0, root.scrollHeight - root.clientHeight);
  const clamped = Math.max(0, Math.min(maxScroll, target));

  window.cancelAnimationFrame(programmaticRaf);
  const delta = clamped - current;
  if (Math.abs(delta) < 1) {
    programmaticUntil = performance.now() + 160;
    return;
  }

  const startedAt = performance.now();
  programmaticUntil = startedAt + durationMs + 160;

  const tick = (now: number) => {
    const t = Math.min(1, (now - startedAt) / durationMs);
    writeScrollTop(root, current + delta * easeInOut(t));
    if (t < 1) {
      programmaticUntil = performance.now() + 160;
      programmaticRaf = window.requestAnimationFrame(tick);
    } else {
      programmaticUntil = performance.now() + 200;
    }
  };
  programmaticRaf = window.requestAnimationFrame(tick);
}
