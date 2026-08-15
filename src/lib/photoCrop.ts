import type { PhotoCrop } from "../types";

export const FULL_CROP: PhotoCrop = {
  left: 0,
  top: 0,
  right: 1,
  bottom: 1
};

/** Smallest remaining span so a crop cannot collapse the picture. */
export const MIN_CROP_SPAN = 0.16;

export function isFullCrop(crop: PhotoCrop | undefined | null): boolean {
  if (!crop) return true;
  return (
    crop.left <= 1e-4 &&
    crop.top <= 1e-4 &&
    crop.right >= 1 - 1e-4 &&
    crop.bottom >= 1 - 1e-4
  );
}

export function clampCrop(crop: PhotoCrop): PhotoCrop {
  let left = Math.max(0, Math.min(1, crop.left));
  let top = Math.max(0, Math.min(1, crop.top));
  let right = Math.max(0, Math.min(1, crop.right));
  let bottom = Math.max(0, Math.min(1, crop.bottom));
  if (right - left < MIN_CROP_SPAN) {
    const mid = (left + right) / 2;
    left = Math.max(0, mid - MIN_CROP_SPAN / 2);
    right = Math.min(1, left + MIN_CROP_SPAN);
    left = right - MIN_CROP_SPAN;
  }
  if (bottom - top < MIN_CROP_SPAN) {
    const mid = (top + bottom) / 2;
    top = Math.max(0, mid - MIN_CROP_SPAN / 2);
    bottom = Math.min(1, top + MIN_CROP_SPAN);
    top = bottom - MIN_CROP_SPAN;
  }
  return { left, top, right, bottom };
}

export function normalizePhotoCrop(raw: unknown): PhotoCrop | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const num = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const left = num(o.left);
  const top = num(o.top);
  const right = num(o.right);
  const bottom = num(o.bottom);
  if (left == null || top == null || right == null || bottom == null) {
    return undefined;
  }
  const crop = clampCrop({ left, top, right, bottom });
  return isFullCrop(crop) ? undefined : crop;
}

export function cropInsetCss(crop: PhotoCrop): string {
  const top = crop.top * 100;
  const right = (1 - crop.right) * 100;
  const bottom = (1 - crop.bottom) * 100;
  const left = crop.left * 100;
  return `inset(${top}% ${right}% ${bottom}% ${left}%)`;
}
