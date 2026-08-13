import type { NormPoint } from "../types";

const FONT_PX = 16;
const PAD_X_PX = 4;
const PAD_Y_PX = 2;
const BORDER_PX = 0;

function measureTextWidthPx(text: string): number {
  if (typeof document === "undefined") {
    return text.length * FONT_PX * 0.52;
  }
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return text.length * FONT_PX * 0.52;
  ctx.font = `650 ${FONT_PX}px system-ui, -apple-system, Segoe UI, sans-serif`;
  return ctx.measureText(text).width;
}

/**
 * Callout box size in normalized image coords.
 * `tw` is fraction of image width; `thY` is fraction of image height
 * (so the leader attaches to the real box edges).
 */
export function calloutMetrics(
  text: string,
  imageWidthPx = 360,
  aspect = 1
): {
  display: string;
  fontSize: number;
  padX: number;
  padY: number;
  tw: number;
  /** Height as fraction of image height (for leader / hit-tests). */
  thY: number;
  /** Height as fraction of image width (for canvas compositing). */
  thW: number;
} {
  const display = text.trim() || "Note";
  const wPx = Math.max(120, imageWidthPx);
  const textW = measureTextWidthPx(display);
  const boxWpx = textW + PAD_X_PX * 2 + BORDER_PX * 2;
  const boxHpx = FONT_PX + PAD_Y_PX * 2 + BORDER_PX * 2;
  const tw = Math.min(0.72, Math.max(0.04, boxWpx / wPx));
  const thW = boxHpx / wPx;
  const thY = boxHpx / (wPx * Math.max(aspect, 1e-6));
  return {
    display,
    fontSize: FONT_PX / wPx,
    padX: PAD_X_PX / wPx,
    padY: PAD_Y_PX / wPx,
    tw,
    thY,
    thW
  };
}

/** Where the leader line meets the text box (label = top-left). */
export function calloutAttachPoint(
  anchor: NormPoint,
  label: NormPoint,
  tw: number,
  thY: number
): NormPoint {
  const bx = label.x;
  const by = label.y;
  const cx = bx + tw / 2;
  const cy = by + thY / 2;
  const dx = anchor.x - cx;
  const dy = anchor.y - cy;
  const clamp = (v: number, lo: number, hi: number) =>
    Math.max(lo, Math.min(hi, v));

  if (Math.abs(dx) * thY > Math.abs(dy) * tw) {
    return dx > 0
      ? { x: bx + tw, y: clamp(anchor.y, by, by + thY) }
      : { x: bx, y: clamp(anchor.y, by, by + thY) };
  }
  return dy > 0
    ? { x: clamp(anchor.x, bx, bx + tw), y: by + thY }
    : { x: clamp(anchor.x, bx, bx + tw), y: by };
}
