import type { NormPoint } from "../types";

/** Type size as a fraction of the picture's longer side. */
export const CALLOUT_FONT_FRAC = 0.042;
const PAD_X_EM = 0.28;
const PAD_Y_EM = 0.14;
const MEASURE_PX = 64;

function measureTextWidthPx(text: string, fontPx: number): number {
  if (typeof document === "undefined") {
    return text.length * fontPx * 0.52;
  }
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return text.length * fontPx * 0.52;
  ctx.font = `650 ${fontPx}px system-ui, -apple-system, Segoe UI, sans-serif`;
  return ctx.measureText(text).width;
}

/**
 * Callout box size in normalized image coords.
 * Font scales with max(width, height) so a phone preview and a 4000px JPEG
 * keep the same relative type size.
 */
export function calloutMetrics(
  text: string,
  aspect = 1
): {
  display: string;
  /** Fraction of image width. */
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
  const longerOverWidth = Math.max(1, aspect);
  const fontW = CALLOUT_FONT_FRAC * longerOverWidth;
  const padX = fontW * PAD_X_EM;
  const padY = fontW * PAD_Y_EM;
  const textW =
    (measureTextWidthPx(display, MEASURE_PX) / MEASURE_PX) * fontW;
  const tw = Math.min(0.92, Math.max(fontW * 1.4, textW + padX * 2));
  const thW = fontW + padY * 2;
  const thY = thW / Math.max(aspect, 1e-6);
  return {
    display,
    fontSize: fontW,
    padX,
    padY,
    tw,
    thY,
    thW
  };
}

export function calloutFontPx(imageWidthPx: number, imageHeightPx: number) {
  return CALLOUT_FONT_FRAC * Math.max(imageWidthPx, imageHeightPx);
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
