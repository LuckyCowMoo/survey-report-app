/** Global UI text scale. Applied as `--text-scale` on :root. */

export const TEXT_SCALE_MIN = 0.85;
export const TEXT_SCALE_MAX = 1.4;
export const TEXT_SCALE_DEFAULT = 1;
export const TEXT_SCALE_EVENT = "ui-text-scale";

export function clampTextScale(value: number): number {
  if (!Number.isFinite(value)) return TEXT_SCALE_DEFAULT;
  return Math.min(TEXT_SCALE_MAX, Math.max(TEXT_SCALE_MIN, value));
}

export function applyTextScale(scale: number): void {
  const next = clampTextScale(scale);
  document.documentElement.style.setProperty("--text-scale", String(next));
  window.dispatchEvent(new Event(TEXT_SCALE_EVENT));
  window.setTimeout(() => fitOverflowingText(), 0);
}

function tooBig(el: HTMLElement): boolean {
  const slop = 1;
  return (
    el.scrollWidth > el.clientWidth + slop ||
    el.scrollHeight > el.clientHeight + slop
  );
}

/**
 * Shrink text inside `[data-fit-text]` containers so it cannot overflow
 * its box. Desired size comes from CSS (`font-size` × `--text-scale`).
 */
export function fitOverflowingText(root: ParentNode = document): void {
  const nodes = root.querySelectorAll<HTMLElement>("[data-fit-text]");
  for (const el of nodes) {
    const target =
      el.querySelector<HTMLElement>("[data-fit-text-inner]") ?? el;
    target.style.fontSize = "";
    const computed = Number.parseFloat(getComputedStyle(target).fontSize);
    if (!Number.isFinite(computed) || computed <= 0) continue;
    let size = computed;
    const min = 10;
    while (size > min && tooBig(el)) {
      size -= 0.5;
      target.style.fontSize = `${size}px`;
    }
  }
}

export function startTextFitWatcher(): () => void {
  let timer = 0;
  const run = () => {
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = 0;
      fitOverflowingText();
    }, 120);
  };
  const ro = new ResizeObserver(run);
  ro.observe(document.documentElement);
  const mo = new MutationObserver(run);
  mo.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: false,
    attributes: false
  });
  window.addEventListener("resize", run);
  window.addEventListener(TEXT_SCALE_EVENT, run);
  run();
  return () => {
    if (timer) window.clearTimeout(timer);
    ro.disconnect();
    mo.disconnect();
    window.removeEventListener("resize", run);
    window.removeEventListener(TEXT_SCALE_EVENT, run);
  };
}
