/**
 * Direct-from-browser AI client (Claude or Gemini, chosen in Settings).
 *
 * Only sections the rule-based matcher could not confidently resolve are sent
 * here. Each call includes the photo (downscaled), the surveyor's note, the
 * relevant approved library paragraphs, and brief summaries of earlier
 * sections (so the model can answer "As illustrated in section N" cases).
 *
 * When a library paragraph is waiting on a meter reading, the model is first
 * asked whether it can confidently read that value from the photo. If not, it
 * falls back to a generic bespoke paragraph (no invented digits).
 */
import {
  extractValues,
  hasMissingPlaceholders,
  isReadingPlaceholder,
  library,
  libraryParagraph,
  placeholderValuesFromNote,
  renderLibraryText,
  resolveLibraryIdForValues
} from "./matcher";
import { imageToAiBase64 } from "./imageUtils";
import type { AiProvider } from "./settings";
import type { LibraryPlaceholder, SectionState } from "../types";

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export interface AiResolution {
  action: "library" | "bespoke" | "crossref" | "skip";
  libraryId?: string;
  placeholderValues?: Record<string, string>;
  text?: string;
  crossrefSection?: number;
  headingLine?: string;
  /** When true, reading placeholders from the model may be applied (confident photo read). */
  acceptReadings?: boolean;
}

interface ReadingProbeResult {
  canRead: boolean;
  values: Record<string, string>;
}

const SYSTEM_PROMPT = `You are the report-writing assistant for a UK damp and timber surveying firm. You convert a surveyor's shorthand field notes and photos into polished report sections.

House style: formal British English surveying prose, third person, precise but readable. Each section explains what the photo shows, why it matters for the building (damp, timber, ventilation, structure), and what further action or investigation is warranted. Sections are typically 60-150 words unless the subject is trivial.

You will be given:
- The photo for this section.
- The surveyor's shorthand note (possibly empty or very terse).
- A list of APPROVED LIBRARY PARAGRAPHS (id + text) that the firm prefers to reuse. Some contain {{placeholder}} slots.
- Summaries of EARLIER SECTIONS in the same report.

Decide ONE of:
1. "library" - an approved paragraph fits this photo. Give its id. For {{placeholder}} slots that are meter readings or measurements (RH%, moisture %, temperatures, heights), leave them OUT of placeholderValues unless that exact figure already appears in the surveyor's shorthand note. Never invent readings and never copy example numbers from the library text. The surveyor will type readings manually.
2. "bespoke" - no approved paragraph fits. Write a new paragraph in house style describing the observation, its significance, and recommended further action. Do not invent specific meter readings; if a reading is needed and is not in the note, write a clear blank such as "[reading required]" instead of a number.
3. "crossref" - the photo shows the same subject as an earlier section and needs no new text. Give that section's number.

If the note contains a "Reading N" style label or the photo is clearly one of a numbered sequence of meter readings, set headingLine accordingly (e.g. "Reading 2").

Respond with ONLY a JSON object, no markdown fences:
{"action":"library"|"bespoke"|"crossref","libraryId":"...","placeholderValues":{"key":"value"},"text":"...","crossrefSection":N,"headingLine":"..."}
Include "text" only for bespoke. Include "libraryId" only for library. Include "placeholderValues" only for non-reading slots or readings that appear in the note. Include "crossrefSection" only for crossref. "headingLine" is optional.`;

const READING_PROBE_PROMPT = `You help a UK damp and timber surveyor by reading meter values from survey photographs.

You will be told exactly which reading(s) are needed (for example relative humidity, moisture content %, temperature). Look only at the photo.

Rules:
- Set canRead to true ONLY if you can clearly and confidently see the digit(s) on a meter display or labelled readout in the photo.
- If the display is blurry, cut off, glare-obscured, ambiguous, or not visible, set canRead to false and omit values.
- Never guess or estimate a reading.
- Return only the keys you were asked for.
- Values should be the numeric reading as shown (e.g. "65", "22.4", "15.5") without units unless the unit is part of a non-numeric slot.

Respond with ONLY a JSON object, no markdown fences:
{"canRead":true|false,"values":{"key":"value"}}`;

const BESPOKE_FALLBACK_PROMPT = `You are the report-writing assistant for a UK damp and timber surveying firm.

House style: formal British English surveying prose, third person, precise but readable. Typically 60-150 words.

A library paragraph would fit this photo, but a required meter reading could not be confidently read from the image. Write a generic bespoke paragraph describing what the photo shows and why it matters, without quoting or inventing any specific meter reading, percentage, or temperature figure. You may say that a reading was taken / a meter is shown, but do not invent digits.

Respond with ONLY a JSON object, no markdown fences:
{"action":"bespoke","text":"...","headingLine":"..."}
"headingLine" is optional.`;

function candidateBlock(section: SectionState): string {
  // Send the suggested candidates plus a compact index of everything else.
  const suggested = new Set(section.suggestions);
  if (section.libraryId) suggested.add(section.libraryId);
  const full = library.photoParagraphs.filter((p) => suggested.has(p.id));
  const rest = library.photoParagraphs.filter((p) => !suggested.has(p.id));
  const lines: string[] = [];
  lines.push("APPROVED LIBRARY PARAGRAPHS (full text of likely candidates):");
  if (full.length === 0) lines.push("(none matched the note)");
  for (const p of full) {
    lines.push(`--- id: ${p.id}\n${p.text}`);
  }
  lines.push("\nOTHER AVAILABLE PARAGRAPHS (id - topic):");
  for (const p of rest) lines.push(`${p.id} - ${p.topic}`);
  return lines.join("\n");
}

function earlierSectionsBlock(sections: SectionState[], index: number): string {
  const lines = ["EARLIER SECTIONS IN THIS REPORT:"];
  for (let i = 0; i < index; i++) {
    const s = sections[i];
    const summary =
      s.text.length > 0 ? s.text.replace(/\s+/g, " ").slice(0, 140) : "(pending)";
    lines.push(`Section ${s.entry.number}: ${summary}`);
  }
  if (lines.length === 1) lines.push("(none)");
  return lines.join("\n");
}

/** Library id we would fill if readings become available. */
function candidateLibraryId(section: SectionState): string | null {
  if (section.libraryId) return section.libraryId;
  return section.suggestions[0] ?? null;
}

/** Reading placeholders still empty on the candidate library paragraph. */
function missingReadingPlaceholders(section: SectionState): LibraryPlaceholder[] {
  const id = candidateLibraryId(section);
  if (!id) return [];
  const paragraph = libraryParagraph(id);
  if (!paragraph) return [];
  return paragraph.placeholders.filter(
    (ph) => isReadingPlaceholder(ph.key) && !section.placeholderValues[ph.key]?.trim()
  );
}

async function callClaude(
  apiKey: string,
  model: string,
  imageB64: string | null,
  userText: string,
  system: string,
  signal?: AbortSignal,
  maxTokens = 1200
): Promise<string> {
  const content: unknown[] = [];
  if (imageB64) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: imageB64 }
    });
  }
  content.push({ type: "text", text: userText });

  const res = await fetch(CLAUDE_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content }]
    }),
    signal
  });

  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      const err = (await res.json()) as { error?: { message?: string } };
      if (err.error?.message) detail = `${res.status}: ${err.error.message}`;
    } catch {
      /* keep status only */
    }
    throw new Error(`Claude API error ${detail}`);
  }
  const data = (await res.json()) as {
    content: Array<{ type: string; text?: string }>;
  };
  // Prefer explicit text blocks (skip thinking blocks on extended-thinking models).
  return data.content.find((b) => b.type === "text")?.text ?? "";
}

async function callGemini(
  apiKey: string,
  model: string,
  imageB64: string | null,
  userText: string,
  system: string,
  signal?: AbortSignal,
  maxOutputTokens = 1200
): Promise<string> {
  const parts: unknown[] = [];
  if (imageB64) {
    parts.push({ inlineData: { mimeType: "image/jpeg", data: imageB64 } });
  }
  parts.push({ text: userText });

  const res = await fetch(`${GEMINI_API_BASE}/${model}:generateContent`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts }],
      generationConfig: {
        maxOutputTokens,
        responseMimeType: "application/json"
      }
    }),
    signal
  });

  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      const err = (await res.json()) as { error?: { message?: string } };
      if (err.error?.message) detail = `${res.status}: ${err.error.message}`;
    } catch {
      /* keep status only */
    }
    throw new Error(`Gemini API error ${detail}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string; thought?: boolean }> };
      finishReason?: string;
    }>;
    promptFeedback?: { blockReason?: string };
  };
  if (data.promptFeedback?.blockReason) {
    throw new Error(`Gemini blocked the request (${data.promptFeedback.blockReason}).`);
  }
  const candidate = data.candidates?.[0];
  // Skip thought/reasoning parts — joining them with the answer breaks JSON parse.
  const text = (candidate?.content?.parts ?? [])
    .filter((p) => !p.thought)
    .map((p) => p.text ?? "")
    .join("");
  if (!text.trim()) {
    const reason = candidate?.finishReason ?? "empty";
    throw new Error(
      `Gemini returned no usable text (finish: ${reason}). Try another model or raise the output limit.`
    );
  }
  return text;
}

async function callModel(
  ai: AiConfig,
  imageB64: string | null,
  userText: string,
  system: string,
  signal?: AbortSignal,
  maxTokens = 1200
): Promise<string> {
  return ai.provider === "gemini"
    ? callGemini(ai.apiKey, ai.model, imageB64, userText, system, signal, maxTokens)
    : callClaude(ai.apiKey, ai.model, imageB64, userText, system, signal, maxTokens);
}

/** Text-only model call (no photo) — used for details extras suggestions. */
export async function callAiText(
  ai: AiConfig,
  userText: string,
  system: string,
  signal?: AbortSignal
): Promise<string> {
  // Higher budget: thinking models spend tokens before the JSON answer.
  return callModel(ai, null, userText, system, signal, 4096);
}

export function extractJsonObject(raw: string): Record<string, unknown> | null {
  return parseJsonObject(raw);
}

/** Extract a top-level JSON array when the model skips the wrapping object. */
export function extractJsonArray(raw: string): unknown[] | null {
  return parseJsonArray(raw);
}

function tryParseJson(slice: string): unknown | null {
  const cleaned = slice
    .replace(/^\uFEFF/, "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    /* try soft repairs below */
  }
  // Trailing commas before } or ]
  try {
    return JSON.parse(cleaned.replace(/,\s*([}\]])/g, "$1"));
  } catch {
    return null;
  }
}

function extractBalancedSlices(raw: string, open: "{" | "[", close: "}" | "]"): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === open) {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === close) {
      if (depth === 0) continue;
      depth--;
      if (depth === 0 && start >= 0) {
        out.push(raw.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return out;
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  if (!raw?.trim()) return null;
  const direct = tryParseJson(raw);
  if (direct && typeof direct === "object" && !Array.isArray(direct)) {
    return direct as Record<string, unknown>;
  }
  // Prefer the last complete {...} (answer often follows thought prose).
  const slices = extractBalancedSlices(raw, "{", "}");
  for (let i = slices.length - 1; i >= 0; i--) {
    const parsed = tryParseJson(slices[i]);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  }
  return null;
}

function parseJsonArray(raw: string): unknown[] | null {
  if (!raw?.trim()) return null;
  const direct = tryParseJson(raw);
  if (Array.isArray(direct)) return direct;
  const slices = extractBalancedSlices(raw, "[", "]");
  for (let i = slices.length - 1; i >= 0; i--) {
    const parsed = tryParseJson(slices[i]);
    if (Array.isArray(parsed)) return parsed;
  }
  return null;
}

function parseResolution(raw: string): AiResolution | null {
  const obj = parseJsonObject(raw);
  if (!obj || typeof obj.action !== "string") return null;
  return obj as unknown as AiResolution;
}

function parseReadingProbe(
  raw: string,
  wanted: LibraryPlaceholder[]
): ReadingProbeResult {
  const obj = parseJsonObject(raw);
  if (!obj) return { canRead: false, values: {} };
  const canRead = obj.canRead === true;
  const values: Record<string, string> = {};
  const rawValues = (obj.values ?? {}) as Record<string, unknown>;
  for (const ph of wanted) {
    const v = rawValues[ph.key];
    if (typeof v === "string" && v.trim()) values[ph.key] = v.trim();
    else if (typeof v === "number" && Number.isFinite(v)) values[ph.key] = String(v);
  }
  const complete = wanted.every((ph) => Boolean(values[ph.key]?.trim()));
  return { canRead: canRead && complete, values: complete ? values : {} };
}

/** Apply an AI resolution onto a section (mutates a copy, returns it). */
export function applyResolution(
  section: SectionState,
  r: AiResolution
): SectionState {
  const next = { ...section };
  if (r.headingLine) next.headingLine = r.headingLine;
  if (r.action === "library" && r.libraryId) {
    // Still credited to AI: the model chose this paragraph.
    // "library" as a source is reserved for the matcher / manual picker.
    // Readings normally only come from the shorthand note - except when
    // acceptReadings marks a confident photo read.
    const paragraph = libraryParagraph(r.libraryId);
    const fromNote = paragraph
      ? placeholderValuesFromNote(paragraph, extractValues(section.entry.note))
      : {};
    const values: Record<string, string> = { ...fromNote };
    for (const [key, raw] of Object.entries(r.placeholderValues ?? {})) {
      const value = raw?.trim() ?? "";
      if (!value) continue;
      if (isReadingPlaceholder(key) && !r.acceptReadings) continue;
      values[key] = value;
    }
    const libraryId = resolveLibraryIdForValues(r.libraryId, values);
    next.libraryId = libraryId;
    next.placeholderValues = values;
    next.text = renderLibraryText(libraryId, values);
    next.source = "ai";
    next.needsAttention = hasMissingPlaceholders(libraryId, values);
    next.pendingReview = false;
    next.pendingNoteConfirm = false;
  } else if (r.action === "bespoke" && r.text) {
    next.libraryId = null;
    next.placeholderValues = {};
    next.text = r.text.trim();
    next.source = "ai";
    next.needsAttention = false;
    next.pendingReview = false;
    next.pendingNoteConfirm = false;
  } else if (r.action === "crossref" && r.crossrefSection) {
    next.libraryId = null;
    next.crossrefSection = r.crossrefSection;
    next.text = `As illustrated in section ${r.crossrefSection}`;
    next.source = "crossref";
    next.needsAttention = false;
    next.pendingReview = false;
    next.pendingNoteConfirm = false;
  }
  return next;
}

export interface AiConfig {
  provider: AiProvider;
  apiKey: string;
  model: string;
}

function providerLabel(ai: AiConfig) {
  return ai.provider === "gemini" ? "Gemini" : "Claude";
}

async function probeMeterReadings(
  section: SectionState,
  missing: LibraryPlaceholder[],
  imageB64: string,
  ai: AiConfig,
  signal?: AbortSignal
): Promise<ReadingProbeResult> {
  const libraryId = candidateLibraryId(section);
  const paragraph = libraryId ? libraryParagraph(libraryId) : undefined;
  const lines = [
    `SECTION NUMBER: ${section.entry.number}`,
    `SURVEYOR'S NOTE: ${section.entry.note ? JSON.stringify(section.entry.note) : "(none)"}`,
    paragraph ? `CANDIDATE LIBRARY TOPIC: ${paragraph.topic}` : "",
    "",
    "REQUIRED READING(S) TO LOOK FOR IN THE PHOTO:"
  ];
  for (const ph of missing) {
    lines.push(`- key "${ph.key}": ${ph.label}`);
  }
  lines.push(
    "",
    "Can you confidently read each of these values from the photo? " +
      "Only answer canRead:true if every listed reading is clearly visible."
  );

  const raw = await callModel(
    ai,
    imageB64,
    lines.filter(Boolean).join("\n"),
    READING_PROBE_PROMPT,
    signal
  );
  return parseReadingProbe(raw, missing);
}

async function resolveBespokeWithoutReading(
  sections: SectionState[],
  index: number,
  missing: LibraryPlaceholder[],
  imageB64: string | null,
  ai: AiConfig,
  signal?: AbortSignal
): Promise<SectionState> {
  const section = sections[index];
  const entry = section.entry;
  const wanted = missing.map((ph) => ph.label).join("; ");
  const parts = [
    `SECTION NUMBER: ${entry.number}`,
    `SURVEYOR'S NOTE: ${entry.note ? JSON.stringify(entry.note) : "(none - work from the photo)"}`,
    section.headingLine ? `CURRENT HEADING LINE: ${section.headingLine}` : "",
    "",
    `REQUIRED READING THAT COULD NOT BE READ FROM THE PHOTO: ${wanted}`,
    "Write a generic house-style paragraph about this photo without inventing that reading.",
    "",
    earlierSectionsBlock(sections, index)
  ].filter(Boolean);

  const raw = await callModel(ai, imageB64, parts.join("\n"), BESPOKE_FALLBACK_PROMPT, signal);
  const resolution = parseResolution(raw);
  if (!resolution || resolution.action !== "bespoke" || !resolution.text) {
    throw new Error(
      `${providerLabel(ai)} returned an unexpected response for section ${entry.number}.`
    );
  }
  return applyResolution(section, resolution);
}

/**
 * Resolve one section with the configured AI provider. Returns the updated
 * section. Throws on network/API errors so the caller can surface them.
 */
export async function resolveSectionWithAi(
  sections: SectionState[],
  index: number,
  ai: AiConfig,
  signal?: AbortSignal
): Promise<SectionState> {
  const section = sections[index];
  const entry = section.entry;

  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  let imageB64: string | null = null;
  if (entry.images.length > 0) {
    imageB64 = await imageToAiBase64(entry.images[0], entry.imageNames[0]);
  }

  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const missingReadings = missingReadingPlaceholders(section);
  const libraryId = candidateLibraryId(section);

  // Library wording is ready except for meter readings: ask the model to read
  // them from the photo first; otherwise write a generic paragraph.
  if (missingReadings.length > 0 && libraryId && imageB64) {
    const probe = await probeMeterReadings(
      section,
      missingReadings,
      imageB64,
      ai,
      signal
    );
    if (probe.canRead) {
      return applyResolution(section, {
        action: "library",
        libraryId,
        placeholderValues: probe.values,
        acceptReadings: true,
        headingLine: section.headingLine || undefined
      });
    }
    return resolveBespokeWithoutReading(
      sections,
      index,
      missingReadings,
      imageB64,
      ai,
      signal
    );
  }

  const parts = [
    `SECTION NUMBER: ${entry.number}`,
    `SURVEYOR'S NOTE: ${entry.note ? JSON.stringify(entry.note) : "(none - work from the photo)"}`,
    section.headingLine ? `CURRENT HEADING LINE: ${section.headingLine}` : "",
    section.source === "manual" && section.text
      ? `The note above is full prose the surveyor wrote. If it reads well, polish it into house style as a bespoke paragraph rather than replacing it with a library paragraph.`
      : "",
    "",
    candidateBlock(section),
    "",
    earlierSectionsBlock(sections, index)
  ].filter(Boolean);

  const userText = parts.join("\n");
  const raw = await callModel(ai, imageB64, userText, SYSTEM_PROMPT, signal);
  const resolution = parseResolution(raw);
  if (!resolution) {
    throw new Error(
      `${providerLabel(ai)} returned an unexpected response for section ${entry.number}.`
    );
  }
  return applyResolution(section, resolution);
}
