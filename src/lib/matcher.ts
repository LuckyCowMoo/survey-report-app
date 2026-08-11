/**
 * Rule-based matcher: turns each parsed shorthand entry into an initial
 * SectionState by matching the surveyor's note against the content library.
 *
 * Philosophy:
 *  - Deterministic keyword rules cover the everyday cases for free.
 *  - Anything terse, empty or unusual is flagged `needsAttention` so the
 *    Claude step (or the surveyor) can resolve it with the photo for context.
 *  - Long unrecognised prose gets `pendingNoteConfirm` (striped pip → confirm as manual)
 *  - Low-confidence library matches with complete wording get `pendingReview`
 *    (yellow) until the surveyor has looked at the section for a few seconds.
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
    .replace(/\bdp\b/g, "dew point")
    .replace(/\br\.?h\.?\b/g, "rh")
    .replace(/\s+/g, " ")
    .trim();
}

export interface ExtractedValues {
  percent?: string;
  temperature?: string;
  height?: string;
  /** Phrasing for {{baseline_location}}, e.g. "the kitchen wall". */
  location?: string;
}

/**
 * Common rooms/areas that can follow "baseline" in shorthand notes.
 * Longer / more specific patterns first.
 */
const BASELINE_AREAS: Array<{ pattern: RegExp; location: string }> = [
  { pattern: /\bfirst[-\s]?floor\s+landing\b/, location: "the first-floor landing wall" },
  { pattern: /\bsecond[-\s]?floor\s+landing\b/, location: "the second-floor landing wall" },
  { pattern: /\bground[-\s]?floor\s+hallway\b/, location: "the ground-floor hallway wall" },
  { pattern: /\bfront\s+bedroom\b/, location: "the front bedroom wall" },
  { pattern: /\brear\s+bedroom\b/, location: "the rear bedroom wall" },
  { pattern: /\bmaster\s+bedroom\b/, location: "the master bedroom wall" },
  { pattern: /\bbedroom\s*(\d+)\b/, location: "the bedroom $1 wall" },
  { pattern: /\bliving\s*rooms?\b|\blounge\b|\bsitting\s*rooms?\b/, location: "the living room wall" },
  { pattern: /\bdining\s*rooms?\b/, location: "the dining room wall" },
  { pattern: /\bshower\s*rooms?\b/, location: "the shower room wall" },
  { pattern: /\bunder\s*stairs?\b|\bunderstairs\b/, location: "the under-stairs wall" },
  { pattern: /\bchimney\s*breast\b/, location: "the chimney breast" },
  { pattern: /\ben[-\s]?suite\b|\bensuite\b/, location: "the en-suite wall" },
  { pattern: /\bcloakrooms?\b/, location: "the cloakroom wall" },
  { pattern: /\bconservatory\b/, location: "the conservatory wall" },
  { pattern: /\butility\b/, location: "the utility room wall" },
  { pattern: /\bbathrooms?\b/, location: "the bathroom wall" },
  { pattern: /\bkitchens?\b/, location: "the kitchen wall" },
  { pattern: /\bhallways?\b|\bhall\b/, location: "the hallway wall" },
  { pattern: /\blandings?\b/, location: "the landing wall" },
  { pattern: /\bbedrooms?\b/, location: "the bedroom wall" },
  { pattern: /\bcellars?\b|\bbasements?\b/, location: "the cellar wall" },
  { pattern: /\bcupboards?\b/, location: "the cupboard wall" },
  { pattern: /\bgarages?\b/, location: "the garage wall" },
  { pattern: /\bporch\b/, location: "the porch wall" },
  { pattern: /\bstud(?:y|ies)\b|\boffices?\b/, location: "the study wall" },
  { pattern: /\bwc\b|\btoilets?\b/, location: "the WC wall" },
  { pattern: /\bstairs?\b|\bstairwell\b/, location: "the stairwell wall" }
];

function extractBaselineLocation(note: string): string | undefined {
  if (!/\bbaseline\b|\bbase\s*line\b/i.test(note)) return undefined;
  for (const { pattern, location } of BASELINE_AREAS) {
    const m = pattern.exec(note);
    if (!m) continue;
    if (location.includes("$1") && m[1]) {
      return location.replace("$1", m[1]);
    }
    return location;
  }
  return undefined;
}

export function extractValues(note: string): ExtractedValues {
  const out: ExtractedValues = {};
  // Prefer an explicit percent sign; also accept "Rh 41.6" / "41.6 rh" / "humidity 46".
  const pct = /(\d+(?:\.\d+)?)\s*%/.exec(note);
  if (pct) {
    out.percent = pct[1];
  } else {
    const rhNum =
      /\brh\b\s*[:=]?\s*(\d+(?:\.\d+)?)/i.exec(note) ||
      /(\d+(?:\.\d+)?)\s*\brh\b/i.exec(note) ||
      /\bhumidity\b\s*[:=]?\s*(\d+(?:\.\d+)?)/i.exec(note);
    if (rhNum) out.percent = rhNum[1];
  }
  // Prefer an explicit degree marker; also accept "dew 15.5" / "Dp 8.7" / "dew point 16".
  const temp = /(-?\d+(?:\.\d+)?)\s*(?:°\s*c?|degrees?\b|deg\b)/i.exec(note);
  if (temp) {
    out.temperature = temp[1];
  } else {
    const dewNum =
      /\bdew\s*point\b\s*[:=]?\s*(-?\d+(?:\.\d+)?)/i.exec(note) ||
      /\bdp\b\s*[:=]?\s*(-?\d+(?:\.\d+)?)/i.exec(note) ||
      /\bdew\b\s*[:=]?\s*(-?\d+(?:\.\d+)?)/i.exec(note) ||
      /(-?\d+(?:\.\d+)?)\s*\b(?:dew(?:\s*point)?|dp)\b/i.exec(note);
    if (dewNum) out.temperature = dewNum[1];
  }
  const height = /(\d+(?:\.\d+)?)\s*(mm|m|cm|metres?|meters?)\b/i.exec(note);
  if (height) out.height = `${height[1]}${height[2].toLowerCase()}`;
  const location = extractBaselineLocation(note);
  if (location) out.location = location;
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

/**
 * Placeholders that must never be invented (library defaults or AI photo reads).
 * Only shorthand extraction or the surveyor's own typing may fill them.
 */
export function isReadingPlaceholder(key: string): boolean {
  return /rh|percent|pin_value|temp|dew|height|diff|baseline_location/i.test(key);
}

/**
 * Pick the RH library paragraph from a typed/extracted percentage.
 * Above 55% → high; otherwise → within threshold.
 */
export function rhLibraryIdForPercent(percent: string): "rh-high" | "rh-low" | null {
  const n = Number(String(percent).trim());
  if (!Number.isFinite(n)) return null;
  return n > 55 ? "rh-high" : "rh-low";
}

/**
 * If this paragraph is RH-related and a reading is present, return the id that
 * matches the threshold wording. Otherwise return the original id.
 */
export function resolveLibraryIdForValues(
  id: string,
  values: Record<string, string>
): string {
  if (id !== "rh-high" && id !== "rh-low") return id;
  const rh = values.rh_value?.trim() ?? "";
  return rhLibraryIdForPercent(rh) ?? id;
}

/** Resolve a library paragraph into display text with known values only. */
export function renderLibraryText(
  id: string,
  values: Record<string, string>
): string {
  const p = byId.get(id);
  if (!p) return "";
  // Do not paste paragraph text until every slot is filled - a half-complete
  // RH sentence with the wrong "surpassing / within" wording is worse than blank.
  if (hasMissingPlaceholders(id, values)) return "";
  const merged: Record<string, string> = {};
  for (const ph of p.placeholders) {
    merged[ph.key] = values[ph.key].trim();
  }
  return fillPlaceholders(p.text, merged);
}

/** True when a library paragraph still has unfilled slots. */
export function hasMissingPlaceholders(
  id: string,
  values: Record<string, string>
): boolean {
  const p = byId.get(id);
  if (!p) return false;
  return p.placeholders.some((ph) => !(values[ph.key]?.trim()));
}

/**
 * Fill placeholders only from values extracted from the shorthand note.
 * Reading slots stay empty until the surveyor types them.
 */
export function placeholderValuesFromNote(
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
    } else if (/baseline_location|location/.test(ph.key) && extracted.location) {
      values[ph.key] = extracted.location;
    } else {
      values[ph.key] = "";
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
    // Only lock high/low wording once a figure exists in the note.
    if (extracted.percent) {
      const id = rhLibraryIdForPercent(extracted.percent);
      if (id) return { id, high: true };
    }
    return null;
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
  // Orientation: full words ("facing north") or letter abbreviations (N, SW, …).
  {
    const DIR_ABBREV: Record<string, string> = {
      n: "north",
      ne: "northeast",
      e: "east",
      se: "southeast",
      s: "south",
      sw: "southwest",
      w: "west",
      nw: "northwest"
    };
    const bareAbbr = /^(ne|nw|se|sw|n|e|s|w)$/.exec(note)?.[1];
    if (bareAbbr) {
      return { id: `weather-${DIR_ABBREV[bareAbbr]}`, high: true };
    }
    if (/\bfacing\b/.test(note)) {
      const dirWord =
        /north\s*east|northeast|north\s*west|northwest|south\s*east|southeast|south\s*west|southwest|north|south|east|west/.exec(
          note
        )?.[0];
      const dirAbbr = /\b(ne|nw|se|sw|n|e|s|w)\b/.exec(note)?.[1];
      const key = dirWord
        ? dirWord.replace(/\s+/g, "")
        : dirAbbr
          ? DIR_ABBREV[dirAbbr]
          : null;
      if (key) {
        const id = `weather-${key}`;
        if (byId.has(id)) return { id, high: true };
      }
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
      pendingReview: false,
      pendingNoteConfirm: false,
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
      // The surveyor wrote real prose - keep it; confirm as-is or polish with AI.
      state.source = "manual";
      state.text = entry.note;
      state.needsAttention = true;
      state.pendingNoteConfirm = true;
      // Track whether this looks like the start of a run of reading photos.
      inReadingRun = /moisture mapp|readings (were|taken)|three readings/.test(note);
      readingCounter = 0;
      sections.push(state);
      continue;
    }

    if (matched) {
      const p = byId.get(matched.id);
      if (p) {
        const values = placeholderValuesFromNote(p, extracted);
        const libraryId = resolveLibraryIdForValues(matched.id, values);
        state.libraryId = libraryId;
        state.placeholderValues = values;
        state.text = renderLibraryText(libraryId, values);
        state.source = "library";
        const missing = hasMissingPlaceholders(libraryId, values);
        // Unfilled readings always need attention - never look "done" with examples.
        // Soft keyword matches with complete wording get a yellow "pending review"
        // pip instead of the orange attention flag.
        state.needsAttention = missing;
        state.pendingReview = !matched.high && !missing;
        if (!state.suggestions.includes(libraryId)) {
          state.suggestions.unshift(libraryId);
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
