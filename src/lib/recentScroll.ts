/** Timestamp of the last scroll on the window or review content pane. */
let lastScrollAt = 0;
let windowBound = false;
let contentEl: HTMLElement | null = null;

function markScroll() {
  lastScrollAt = performance.now();
}

/** Keep listeners on the window and the desktop aside scroll pane. */
function ensureScrollListeners() {
  if (typeof window === "undefined") return;
  if (!windowBound) {
    windowBound = true;
    window.addEventListener("scroll", markScroll, { passive: true });
    // Bubbles from the aside pane; covers trackpad/wheel before scroll listeners attach.
    window.addEventListener("wheel", markScroll, { passive: true });
  }
  const next = document.querySelector<HTMLElement>(".app.app-aside .content");
  if (next === contentEl) return;
  contentEl?.removeEventListener("scroll", markScroll);
  contentEl = next;
  contentEl?.addEventListener("scroll", markScroll, { passive: true });
}

/** True when the page/list has scrolled within the last `withinMs`. */
export function scrolledRecently(withinMs = 500): boolean {
  ensureScrollListeners();
  return performance.now() - lastScrollAt < withinMs;
}

// Attach early so wheel/trackpad scrolling is tracked before the first hover.
if (typeof window !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ensureScrollListeners, {
      once: true
    });
  } else {
    ensureScrollListeners();
  }
}
