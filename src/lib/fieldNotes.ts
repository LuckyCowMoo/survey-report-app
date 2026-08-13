import type { FieldNoteShot, ShorthandEntry } from "../types";
import { matchEntries } from "./matcher";

/** Report-and-Run style Created line, e.g. "Thu, 8/6/2026". */
export function formatFieldNoteCreated(date = new Date()): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const day = days[date.getDay()] ?? "Mon";
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const y = date.getFullYear();
  return `${day}, ${m}/${d}/${y}`;
}

export function newFieldNoteId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `shot-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function renumberFieldNotes(shots: FieldNoteShot[]): FieldNoteShot[] {
  return shots.map((s, i) => ({
    ...s,
    number: i + 1,
    imageName: s.imageName || `image${i + 1}.jpeg`
  }));
}

export function fieldNotesToShorthand(shots: FieldNoteShot[]): ShorthandEntry[] {
  return renumberFieldNotes(shots).map((s) => ({
    number: s.number,
    note: s.note,
    created: s.created,
    imageNames: [
      s.imageName.replace(/^word\/media\//i, "") || `image${s.number}.jpeg`
    ],
    images: [s.image]
  }));
}

/** Notes that the library matcher recognises as valid shorthand keywords. */
export function countMatchedShorthandNotes(shots: FieldNoteShot[]): number {
  if (shots.length === 0) return 0;
  const entries: ShorthandEntry[] = shots.map((s, i) => ({
    number: i + 1,
    note: s.note,
    created: s.created,
    imageNames: [],
    images: []
  }));
  return matchEntries(entries).filter((s) => s.source === "library").length;
}

export function createFieldNoteShot(
  image: Uint8Array,
  partial?: Partial<Pick<FieldNoteShot, "note" | "created" | "imageName">>
): FieldNoteShot {
  const n = 0;
  return {
    id: newFieldNoteId(),
    number: n,
    note: partial?.note ?? "",
    created: partial?.created ?? formatFieldNoteCreated(),
    imageName: partial?.imageName ?? "image.jpeg",
    image
  };
}

export function moveFieldNote(
  shots: FieldNoteShot[],
  from: number,
  to: number
): FieldNoteShot[] {
  if (from < 0 || from >= shots.length) return shots;
  if (to < 0 || to >= shots.length || from === to) return shots;
  const next = shots.slice();
  const [item] = next.splice(from, 1);
  if (!item) return shots;
  next.splice(to, 0, item);
  return renumberFieldNotes(next);
}
