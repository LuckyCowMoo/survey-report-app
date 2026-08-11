import type { SectionState } from "../types";
import { mimeFromName } from "./imageUtils";

/** Prefer front-elevation photo; otherwise the first section that has an image. */
export function pickCoverSection(sections: SectionState[]): SectionState | null {
  const withImage = sections.filter((s) => s.entry.images.length > 0);
  if (withImage.length === 0) return null;

  const front = withImage.find((s) => {
    if (s.libraryId === "front-elevation") return true;
    const note = s.entry.note.trim().toLowerCase();
    return (
      note === "front" ||
      /\bfront\s+elevation\b/.test(note) ||
      /\bfront\s+of\s+(the\s+)?property\b/.test(note)
    );
  });
  return front ?? withImage[0] ?? null;
}

/** Small JPEG thumbnail for past-report tiles. */
export async function coverThumbnailBlob(
  sections: SectionState[],
  maxEdge = 640
): Promise<Blob | null> {
  const section = pickCoverSection(sections);
  if (!section) return null;
  const bytes = section.entry.images[0];
  const name = section.entry.imageNames[0] || "cover.jpg";
  if (!bytes?.length) return null;

  const mime = mimeFromName(name);
  const copy = new Uint8Array(bytes);
  const blob = new Blob([copy.buffer], { type: mime });
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, w, h);
    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.82);
    });
  } finally {
    bitmap.close();
  }
}

/** First comma-separated part of the address, used as the house name on tiles. */
export function houseNameFromAddress(address: string): string {
  const t = address.trim();
  if (!t) return "";
  return t.split(",")[0]?.trim() || t;
}
