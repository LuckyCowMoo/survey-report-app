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

/** Core survey photos/readings shown on the field-notes summary slide. */
const FIELD_NOTE_CHECKLIST: FieldNoteChecklistItem[] = [
  { id: "front", label: "front picture", hint: "front" },
  { id: "compass", label: "compass picture", hint: "N / facing north" },
  { id: "air-quality", label: "air quality picture", hint: "air quality" },
  { id: "rh", label: "relative humidity", hint: "rh 45%" },
  { id: "dew-point", label: "dew point", hint: "dew 12°" },
  { id: "baseline", label: "baseline", hint: "baseline kitchen" },
  { id: "three-readings", label: "3 readings location", hint: "1.2m / three readings" },
  { id: "reading-1", label: "reading 1", hint: "reading 1" },
  { id: "reading-2", label: "reading 2", hint: "reading 2" },
  { id: "reading-3", label: "reading 3", hint: "reading 3" },
  { id: "steel-pin", label: "steel pin reading", hint: "pin skirting" },
  { id: "thermal", label: "thermal camera cold spots", hint: "thermal / cold spots" },
  { id: "moisture-map-1", label: "moisture map 1", hint: "moisture map" },
  { id: "moisture-map-2", label: "moisture map 2", hint: "moisture map" },
  { id: "moisture-map-3", label: "moisture map 3", hint: "moisture map" }
];

function readingNumber(section: SectionState, shot: FieldNoteShot): number | null {
  const heading = /^reading\s*(\d+)/i.exec(section.headingLine.trim());
  if (heading) return Number(heading[1]);
  const note = /^reading\s*(\d+)/i.exec(shot.note.trim());
  if (note) return Number(note[1]);
  return null;
}

function isMoistureMapNote(section: SectionState, shot: FieldNoteShot): boolean {
  if (section.libraryId === "readings-intro-wall") return true;
  return /moisture\s*mapp?/.test(shot.note);
}

function checklistCovered(
  id: string,
  sections: SectionState[],
  shots: FieldNoteShot[]
): boolean {
  const libraryIds = sections
    .map((s) => s.libraryId)
    .filter((x): x is string => Boolean(x));
  const has = (prefix: string) => libraryIds.some((x) => x.startsWith(prefix) || x === prefix);

  if (id === "front") return libraryIds.includes("front-elevation");
  if (id === "compass") return libraryIds.some((x) => x.startsWith("weather-"));
  if (id === "air-quality") {
    return (
      libraryIds.includes("air-quality-high-humidity") ||
      libraryIds.includes("air-quality-no-issues")
    );
  }
  if (id === "rh") return libraryIds.includes("rh-high") || libraryIds.includes("rh-low");
  if (id === "dew-point") return libraryIds.includes("dew-point");
  if (id === "baseline") return libraryIds.includes("baseline-reading");
  if (id === "three-readings") {
    return (
      libraryIds.includes("three-readings-heights") ||
      libraryIds.includes("readings-intro-wall")
    );
  }
  if (id === "reading-1" || id === "reading-2" || id === "reading-3") {
    const want = Number(id.slice(-1));
    return sections.some((s, i) => readingNumber(s, shots[i]!) === want);
  }
  if (id === "steel-pin") return has("steel-pins-");
  if (id === "thermal") {
    return libraryIds.some(
      (x) => x.startsWith("thermal-") || x.startsWith("infrared-")
    );
  }
  if (id === "moisture-map-1" || id === "moisture-map-2" || id === "moisture-map-3") {
    const want = Number(id.slice(-1));
    let count = 0;
    for (let i = 0; i < sections.length; i++) {
      if (isMoistureMapNote(sections[i]!, shots[i]!)) count += 1;
      if (count >= want) return true;
    }
    return false;
  }
  return false;
}

/** Important standard-wording sections not yet matched on any field note. */
export function missingFieldNoteChecklist(
  shots: FieldNoteShot[]
): FieldNoteChecklistItem[] {
  const sections = shots.length > 0 ? matchFieldNoteShots(shots) : [];
  return FIELD_NOTE_CHECKLIST.filter(
    (item) => !checklistCovered(item.id, sections, shots)
  );
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
