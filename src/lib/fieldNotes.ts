import type { FieldNoteShot, SectionState, ShorthandEntry, TextSource } from "../types";
import { matchEntries } from "./matcher";
import { compositeAnnotationsOntoJpeg } from "./annotationComposite";

/** Same tones as review / studio status pips. */
export type FieldNotePipTone =
  | "attention"
  | "noteConfirm"
  | "review"
  | "ai"
  | "library"
  | "manual"
  | "empty";

export function pipToneFromSection(s: SectionState): FieldNotePipTone {
  if (s.pendingNoteConfirm) return "noteConfirm";
  if (s.needsAttention) return "attention";
  if (s.pendingReview) return "review";
  switch (s.source as TextSource) {
    case "ai":
      return "ai";
    case "library":
      return "library";
    case "manual":
    case "crossref":
      return "manual";
    default:
      return "empty";
  }
}

/** Status pip colour for each field-note shot (matched like review sections). */
export function fieldNotePipTones(shots: FieldNoteShot[]): FieldNotePipTone[] {
  if (shots.length === 0) return [];
  return matchFieldNoteShots(shots).map(pipToneFromSection);
}

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

/**
 * Convert field notes to shorthand entries.
 * Images are composited with vector annotations for Word/review visuals;
 * annotation vectors are kept on the entry for .dmsr round-trip.
 */
export async function fieldNotesToShorthand(
  shots: FieldNoteShot[]
): Promise<ShorthandEntry[]> {
  const numbered = renumberFieldNotes(shots);
  return Promise.all(
    numbered.map(async (s) => {
      const annotations = s.annotations?.length ? s.annotations : undefined;
      const photoCrop = s.photoCrop;
      const image = await compositeAnnotationsOntoJpeg(
        s.image,
        annotations,
        photoCrop
      );
      return {
        number: s.number,
        note: s.note,
        created: s.created,
        imageNames: [
          s.imageName.replace(/^word\/media\//i, "") || `image${s.number}.jpeg`
        ],
        images: [image],
        ...(annotations ? { annotations } : {}),
        ...(photoCrop ? { photoCrop } : {})
      };
    })
  );
}

function matchFieldNoteShots(shots: FieldNoteShot[]) {
  const entries: ShorthandEntry[] = shots.map((s, i) => ({
    number: i + 1,
    note: s.note,
    created: s.created,
    imageNames: [],
    images: []
  }));
  return matchEntries(entries);
}

/** Match a single shorthand note the same way review sections do. */
export function matchOneFieldNote(note: string): SectionState {
  return matchFieldNoteShots([
    {
      id: "preview",
      number: 1,
      note,
      created: "",
      imageName: "",
      image: new Uint8Array()
    }
  ])[0]!;
}

/** Notes that the library matcher recognises as valid shorthand keywords. */
export function countMatchedShorthandNotes(shots: FieldNoteShot[]): number {
  if (shots.length === 0) return 0;
  return matchFieldNoteShots(shots).filter((s) => s.source === "library").length;
}

export type FieldNoteChecklistItem = {
  id: string;
  label: string;
  hint: string;
};

/** Core survey photos/readings, most important first. Site-specific items omitted. */
const FIELD_NOTE_CHECKLIST: FieldNoteChecklistItem[] = [
  { id: "front-elevation", label: "Front elevation photo", hint: "front" },
  {
    id: "orientation",
    label: "Cardinal direction screenshot",
    hint: "N / facing north"
  },
  { id: "rear-elevation", label: "Rear elevation photo", hint: "rear" },
  { id: "rh", label: "Relative humidity", hint: "rh 45%" },
  { id: "dew-point", label: "Dew point", hint: "dew 12°" },
  {
    id: "baseline-reading",
    label: "Baseline moisture reading",
    hint: "baseline kitchen"
  },
  { id: "air-quality", label: "Air quality test", hint: "air quality" }
];

function checklistCovered(id: string, libraryIds: Set<string>): boolean {
  if (id === "orientation") {
    for (const x of libraryIds) {
      if (x.startsWith("weather-")) return true;
    }
    return false;
  }
  if (id === "rh") return libraryIds.has("rh-high") || libraryIds.has("rh-low");
  if (id === "air-quality") {
    return (
      libraryIds.has("air-quality-high-humidity") ||
      libraryIds.has("air-quality-no-issues")
    );
  }
  return libraryIds.has(id);
}

/** Important standard-wording sections not yet matched on any field note. */
export function missingFieldNoteChecklist(
  shots: FieldNoteShot[]
): FieldNoteChecklistItem[] {
  const libraryIds = new Set(
    matchFieldNoteShots(shots)
      .filter((s) => s.source === "library" && s.libraryId)
      .map((s) => s.libraryId as string)
  );
  return FIELD_NOTE_CHECKLIST.filter((item) => !checklistCovered(item.id, libraryIds));
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

/** Rebuild field-note shots from review sections (photo + shorthand note). */
export function sectionsToFieldNotes(sections: SectionState[]): FieldNoteShot[] {
  const shots: FieldNoteShot[] = [];
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i]!;
    const image = s.entry.images[0];
    if (!image || image.length === 0) continue;
    const name =
      s.entry.imageNames[0]?.replace(/^word\/media\//i, "") ||
      `image${shots.length + 1}.jpeg`;
    shots.push({
      id: newFieldNoteId(),
      number: shots.length + 1,
      note: s.entry.note,
      created: s.entry.created || formatFieldNoteCreated(),
      imageName: name,
      image,
      ...(s.entry.annotations?.length
        ? { annotations: s.entry.annotations }
        : {}),
      ...(s.entry.photoCrop ? { photoCrop: s.entry.photoCrop } : {})
    });
  }
  return renumberFieldNotes(shots);
}

/**
 * Prefer in-memory field notes when returning from review (keeps unburned
 * photos + annotations). Falls back to rebuilding from section images.
 */
export function fieldNotesForReviewReturn(
  sections: SectionState[],
  previous: FieldNoteShot[]
): FieldNoteShot[] {
  if (
    previous.length > 0 &&
    previous.length === sections.length &&
    previous.every((shot, i) => shot.image.length > 0 && sections[i])
  ) {
    return renumberFieldNotes(
      previous.map((shot, i) => {
        const s = sections[i]!;
        return {
          ...shot,
          note: s.entry.note,
          created: s.entry.created || shot.created,
          ...(s.entry.photoCrop
            ? { photoCrop: s.entry.photoCrop }
            : shot.photoCrop
              ? { photoCrop: shot.photoCrop }
              : {})
        };
      })
    );
  }
  return sectionsToFieldNotes(sections);
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
