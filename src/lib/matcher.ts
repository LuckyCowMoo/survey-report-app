/**
 * Rule-based matcher: turns each parsed shorthand entry into an initial
 * SectionState by matching the surveyor's note against the content library.
 *
 * Philosophy:
 *  - Deterministic keyword rules cover the everyday cases for free.
 *  - Anything terse, empty or unusual is flagged `needsAttention` so the
 *    Claude step (or the surveyor) can resolve it with the photo for context.
 *  - A long note is treated as the surveyor's own prose: it becomes the text
 *    directly and is flagged so the AI can optionally polish it into house
 *    style.
 */
import rawLibrary from "../data/content-library.json";
import { fillPlaceholders } from "../data/boilerplate";
import type {
  ContentLibrary,
  LibraryParagraph,
  SectionState,
  ShorthandEntry
} from "../types";

export const library = rawLibrary as unknown as ContentLibrary;

const byId = new Map(library.photoParagraphs.map((p) => [p.id, p]));

export function libraryParagraph(id: string): LibraryParagraph | undefined {
  return byId.get(id);
}

/** Normalise the note for matching: lowercase and fix common shorthand. */
function normalise(note: string): string {
  return note
    .toLowerCase()
    .replace(/\binfa\s*red\b/g, "infrared")
    .replace(/\binfra\s*red\b/g, "infrared")
    .replace(/\bdew\s*piont\b/g, "dew point")
    .replace(/\br\.?h\.?\b/g, "rh")
    .replace(/\s+/g, " ")
    .trim();
}

export interface ExtractedValues {
  percent?: string;
  temperature?: string;
  height?: string;
}

export function extractValues(note: string): ExtractedValues {
  const out: ExtractedValues = {};
  const pct = /(\d+(?:\.\d+)?)\s*%/.exec(note);
  if (pct) out.percent = pct[1];
  const temp = /(-?\d+(?:\.\d+)?)\s*(?:°\s*c?|degrees?\b|deg\b)/i.exec(note);
  if (temp) out.temperature = temp[1];
  const height = /(\d+(?:\.\d+)?)\s*(mm|m|cm|metres?|meters?)\b/i.exec(note);
  if (height) out.height = `${height[1]}${height[2].toLowerCase()}`;
  return out;
}

/** Score a library paragraph against a normalised note. */
function score(p: LibraryParagraph, note: string): number {
  let s = 0;
  for (const kw of p.keywords) {
    if (note.includes(kw.toLowerCase())) {
      // Longer keywords are stronger evidence than single words.
      s += kw.length >= 8 ? 3 : kw.length >= 4 ? 2 : 1;
    }
  }
  return s;
}

function rankedSuggestions(note: string, limit = 4): string[] {
  return library.photoParagraphs
    .map((p) => ({ id: p.id, s: score(p, note) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((r) => r.id);
}

/** Resolve a library paragraph into display text with placeholders filled. */
export function renderLibraryText(
  id: string,
  values: Record<string, string>
): string {
  const p = byId.get(id);
  if (!p) return "";
  const merged: Record<string, string> = {};
  for (const ph of p.placeholders) {
    merged[ph.key] = values[ph.key] ?? ph.default;
  }
  return fillPlaceholders(p.text, merged);
}

function defaultPlaceholderValues(
  p: LibraryParagraph,
  extracted: ExtractedValues
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const ph of p.placeholders) {
    if (/rh|percent|pin_value/.test(ph.key) && extracted.percent) {
      values[ph.key] = extracted.percent;
    } else if (/temp|dew/.test(ph.key) && extracted.temperature) {
      values[ph.key] = extracted.temperature;
    } else if (/height/.test(ph.key) && extracted.height) {
      values[ph.key] = extracted.height;
    } else {
      values[ph.key] = ph.default;
    }
  }
  return values;
}

const WORD_COUNT_LONG_NOTE = 12;

/**
 * Deterministic special-case rules. Returns a library id and confidence when
 * one clearly applies.
 */
function specialRules(
  note: string,
  extracted: ExtractedValues
): { id: string; high: boolean } | null {
  if (/\b999\b/.test(note)) {
    if (/masonry|brick|mortar/.test(note)) {
      return { id: "reading-999-resistance", high: true };
    }
    return { id: "reading-999-saturation", high: true };
  }
  if (/\bbaseline\b/.test(note)) return { id: "baseline-reading", high: true };
  if (/\bdew point\b|\bdew\b/.test(note)) return { id: "dew-point", high: !!extracted.temperature };
  if (/\brh\b|humidity/.test(note)) {
    if (extracted.percent) {
      return {
        id: Number(extracted.percent) > 55 ? "rh-high" : "rh-low",
        high: true
      };
    }
    return { id: "rh-high", high: false };
  }
  if (/\bair quality\b/.test(note)) {
    if (/no issue|ok\b|fine\b|good\b|clear\b|pass/.test(note)) {
      return { id: "air-quality-no-issues", high: true };
    }
    return { id: "air-quality-high-humidity", high: false };
  }
  if (/\bpin(s)?\b|steel pin/.test(note)) {
    if (/skirting/.test(note)) return { id: "steel-pins-skirting", high: true };
    if (/joist/.test(note)) return { id: "steel-pins-joists", high: true };
    if (/subfloor|sub floor/.test(note)) return { id: "steel-pins-subfloor", high: true };
    if (/block|wood floor/.test(note)) return { id: "steel-pins-block-floor", high: true };
    if (/plaster/.test(note)) return { id: "steel-pins-plaster", high: true };
    if (/door/.test(note)) return { id: "steel-pins-doorframe", high: true };
    return { id: "steel-pins-doorframe", high: false };
  }
  if (/infrared|laser/.test(note)) return { id: "infrared-detailed", high: false };
  if (/thermal/.test(note)) {
    if (/ceiling|mould|mold/.test(note)) {
      return { id: "thermal-ceiling-mould", high: true };
    }
    if (/heat loss|hallway/.test(note)) {
      return { id: "thermal-heat-loss", high: true };
    }
    if (/wall/.test(note)) return { id: "thermal-walls-damp", high: true };
    return { id: "thermal-walls-damp", high: false };
  }
  // A bare measurement like "1.2m" refers to the three-readings pattern.
  if (/^\d+(\.\d+)?\s*(m|mm|cm|metres?|meters?)$/.test(note)) {
    return { id: "three-readings-heights", high: false };
  }
  if (/facing/.test(note)) {
    const dir = /north\s*east|northeast|north\s*west|northwest|south\s*east|southeast|south\s*west|southwest|north|south|east|west/.exec(
      note
    )?.[0];
    if (dir) {
      const id = "weather-" + dir.replace(/\s+/g, "");
      if (byId.has(id)) return { id, high: true };
    }
  }
  if (/^front$/.test(note) || /front elevation/.test(note)) {
    return { id: "front-elevation", high: true };
  }
  if (/^rear$|^back$/.test(note) || /rear elevation/.test(note)) {
    return { id: "rear-elevation", high: true };
  }
  return null;
}

/** Build the initial section states for all entries. */
export function matchEntries(entries: ShorthandEntry[]): SectionState[] {
  const sections: SectionState[] = [];
  let readingCounter = 0;
  let inReadingRun = false;

  for (const entry of entries) {
    const note = normalise(entry.note);
    const extracted = extractValues(entry.note);
    const suggestions = note ? rankedSuggestions(note) : [];
    const wordCount = note ? note.split(" ").length : 0;

    const state: SectionState = {
      entry,
      libraryId: null,
      placeholderValues: {},
      headingLine: "",
      crossrefSection: null,
      text: "",
      source: "empty",
      needsAttention: false,
      suggestions
    };

    // Explicit "Reading N" prefix in the note.
    const readingPrefix = /^reading\s*(\d+)/.exec(note);
    if (readingPrefix) {
      state.headingLine = `Reading ${readingPrefix[1]}`;
      inReadingRun = true;
      readingCounter = Number(readingPrefix[1]);
    }

    if (note.length === 0) {
      // No note at all: continue a run of reading photos if one is active,
      // otherwise the AI / surveyor must decide from the photo.
      if (inReadingRun) {
        readingCounter += 1;
        state.headingLine = `Reading ${readingCounter}`;
      }
      state.needsAttention = true;
      sections.push(state);
      continue;
    }

    const special = specialRules(note, extracted);
    const matched = special ?? (suggestions[0] ? { id: suggestions[0], high: false } : null);

    if (wordCount >= WORD_COUNT_LONG_NOTE) {
      // The surveyor wrote real prose - keep it, offer AI polish.
      state.source = "manual";
      state.text = entry.note;
      state.needsAttention = true;
      // Track whether this looks like the start of a run of reading photos.
      inReadingRun = /moisture mapp|readings (were|taken)|three readings/.test(note);
      readingCounter = 0;
      sections.push(state);
      continue;
    }

    if (matched) {
      const p = byId.get(matched.id);
      if (p) {
        state.libraryId = matched.id;
        state.placeholderValues = defaultPlaceholderValues(p, extracted);
        state.text = renderLibraryText(matched.id, state.placeholderValues);
        state.source = "library";
        state.needsAttention = !matched.high;
        if (!state.suggestions.includes(matched.id)) {
          state.suggestions.unshift(matched.id);
        }
      }
      // Reading-run bookkeeping: measurement/meter photos continue a run.
      if (/^\d/.test(note) || /pin|reading/.test(note)) {
        if (inReadingRun) {
          readingCounter += 1;
          if (!state.headingLine) state.headingLine = `Reading ${readingCounter}`;
        }
      } else {
        inReadingRun = false;
        readingCounter = 0;
      }
    } else {
      // Terse note with no match at all - needs the photo for context.
      state.source = "manual";
      state.text = entry.note;
      state.needsAttention = true;
      inReadingRun = false;
      readingCounter = 0;
    }

    sections.push(state);
  }

  return sections;
}
