/**
 * When the wide studio companion (photo + pips) should appear.
 * - Square or landscape (aspect ≥ 1:1): tablets, landscape phones, many foldables open
 * - Near-square tall foldables (e.g. Z Fold open ~0.8:1): both sides large enough for two columns
 */
export const STUDIO_LAYOUT_MQ =
  "(min-aspect-ratio: 1/1), (min-aspect-ratio: 3/4) and (min-width: 700px) and (min-height: 700px)";

export function matchesStudioLayout(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia(STUDIO_LAYOUT_MQ).matches;
}
