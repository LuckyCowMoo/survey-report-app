/**
 * Direct-from-browser AI client (Claude or Gemini, chosen in Settings).
 *
 * Only sections the rule-based matcher could not confidently resolve are sent
 * here. Each call includes the photo (downscaled), the surveyor's note, the
 * relevant approved library paragraphs, and brief summaries of earlier
 * sections (so the model can answer "As illustrated in section N" cases).
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
import type { SectionState } from "../types";

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export interface AiResolution {
  action: "library" | "bespoke" | "crossref" | "skip";
  libraryId?: string;
  placeholderValues?: Record<string, string>;
  text?: string;
  crossrefSection?: number;
  headingLine?: string;
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

async function callClaude(
  apiKey: string,
  model: string,
  imageB64: string | null,
  userText: string
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
      max_tokens: 1200,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content }]
    })
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
  return data.content.find((b) => b.type === "text")?.text ?? "";
}

async function callGemini(
  apiKey: string,
  model: string,
  imageB64: string | null,
  userText: string
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
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts }],
      generationConfig: {
        maxOutputTokens: 1200,
        responseMimeType: "application/json"
      }
    })
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
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
    promptFeedback?: { blockReason?: string };
  };
  if (data.promptFeedback?.blockReason) {
    throw new Error(`Gemini blocked the request (${data.promptFeedback.blockReason}).`);
  }
  const text = (data.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("");
  return text;
}

function parseResolution(raw: string): AiResolution | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(raw.slice(start, end + 1)) as AiResolution;
    if (!obj.action) return null;
    return obj;
  } catch {
    return null;
  }
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
    // Readings may only come from the shorthand note - never AI photo guesses
    // or library example defaults.
    const paragraph = libraryParagraph(r.libraryId);
    const fromNote = paragraph
      ? placeholderValuesFromNote(paragraph, extractValues(section.entry.note))
      : {};
    const values: Record<string, string> = { ...fromNote };
    for (const [key, raw] of Object.entries(r.placeholderValues ?? {})) {
      const value = raw?.trim() ?? "";
      if (!value) continue;
      if (isReadingPlaceholder(key)) continue;
      values[key] = value;
    }
    const libraryId = resolveLibraryIdForValues(r.libraryId, values);
    next.libraryId = libraryId;
    next.placeholderValues = values;
    next.text = renderLibraryText(libraryId, values);
    next.source = "ai";
    next.needsAttention = hasMissingPlaceholders(libraryId, values);
  } else if (r.action === "bespoke" && r.text) {
    next.libraryId = null;
    next.text = r.text.trim();
    next.source = "ai";
    next.needsAttention = false;
  } else if (r.action === "crossref" && r.crossrefSection) {
    next.libraryId = null;
    next.crossrefSection = r.crossrefSection;
    next.text = `As illustrated in section ${r.crossrefSection}`;
    next.source = "crossref";
    next.needsAttention = false;
  }
  return next;
}

export interface AiConfig {
  provider: AiProvider;
  apiKey: string;
  model: string;
}

/**
 * Resolve one section with the configured AI provider. Returns the updated
 * section. Throws on network/API errors so the caller can surface them.
 */
export async function resolveSectionWithAi(
  sections: SectionState[],
  index: number,
  ai: AiConfig
): Promise<SectionState> {
  const section = sections[index];
  const entry = section.entry;

  let imageB64: string | null = null;
  if (entry.images.length > 0) {
    imageB64 = await imageToAiBase64(entry.images[0], entry.imageNames[0]);
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
  const raw =
    ai.provider === "gemini"
      ? await callGemini(ai.apiKey, ai.model, imageB64, userText)
      : await callClaude(ai.apiKey, ai.model, imageB64, userText);
  const resolution = parseResolution(raw);
  if (!resolution) {
    throw new Error(
      `${ai.provider === "gemini" ? "Gemini" : "Claude"} returned an unexpected response for section ${entry.number}.`
    );
  }
  return applyResolution(section, resolution);
}
