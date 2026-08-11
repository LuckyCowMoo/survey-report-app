import type {
  ReportExtras,
  ReportMetadata,
  SectionState,
  ShorthandEntry,
  TextSource
} from "../types";

/** Proprietary DampMaster survey project (pre-generation design state). */
export const PROJECT_KIND = "dampmaster.survey.project";
export const PROJECT_VERSION = 1;
export const PROJECT_EXT = ".dmsr";
export const PROJECT_MIME = "application/vnd.dampmaster.survey+json";

export type ProjectStep = "review" | "details";

export interface ReportProject {
  kind: typeof PROJECT_KIND;
  version: number;
  savedAt: number;
  /** Last design step before Word generation. */
  step: ProjectStep;
  fileName: string;
  /** Fingerprint of the imported field-notes source, for resume matching. */
  sourceFingerprint?: string;
  sections: SectionState[];
  metadata: ReportMetadata;
  extras: ReportExtras;
  warnings: string[];
}

interface SerializedEntry {
  number: number;
  note: string;
  created: string;
  imageNames: string[];
  /** Base64 image payloads parallel to imageNames. */
  images: string[];
}

interface SerializedSection {
  entry: SerializedEntry;
  libraryId: string | null;
  placeholderValues: Record<string, string>;
  headingLine: string;
  crossrefSection: number | null;
  text: string;
  source: TextSource;
  needsAttention: boolean;
  pendingReview: boolean;
  pendingNoteConfirm: boolean;
  suggestions: string[];
}

interface SerializedProject {
  kind: string;
  version: number;
  savedAt: number;
  step: ProjectStep;
  fileName: string;
  sourceFingerprint?: string;
  sections: SerializedSection[];
  metadata: ReportMetadata;
  extras: ReportExtras;
  warnings: string[];
}

/** Stable id for an imported field-notes document (notes + photo sizes). */
export async function fingerprintSourceEntries(
  entries: Array<
    Pick<ShorthandEntry, "number" | "note" | "created" | "imageNames" | "images">
  >
): Promise<string> {
  const lines = [...entries]
    .sort((a, b) => a.number - b.number)
    .map((e) =>
      [
        e.number,
        e.note.trim(),
        e.created.trim(),
        e.imageNames.join(","),
        e.images.map((img) => img.byteLength).join(",")
      ].join("\t")
    );
  const material = `v1\n${lines.join("\n")}`;
  const data = new TextEncoder().encode(material);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function fingerprintSourceSections(
  sections: SectionState[]
): Promise<string> {
  return fingerprintSourceEntries(sections.map((s) => s.entry));
}

function bytesToBase64(bytes: Uint8Array): string {
  const copy =
    bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
      ? bytes
      : bytes.slice();
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < copy.length; i += chunk) {
    binary += String.fromCharCode(...copy.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function serializeSection(section: SectionState): SerializedSection {
  const { entry } = section;
  return {
    entry: {
      number: entry.number,
      note: entry.note,
      created: entry.created,
      imageNames: [...entry.imageNames],
      images: entry.images.map((img) => bytesToBase64(img))
    },
    libraryId: section.libraryId,
    placeholderValues: { ...section.placeholderValues },
    headingLine: section.headingLine,
    crossrefSection: section.crossrefSection,
    text: section.text,
    source: section.source,
    needsAttention: section.needsAttention,
    pendingReview: section.pendingReview,
    pendingNoteConfirm: section.pendingNoteConfirm,
    suggestions: [...section.suggestions]
  };
}

function deserializeEntry(raw: SerializedEntry): ShorthandEntry {
  const names = Array.isArray(raw.imageNames) ? raw.imageNames.map(String) : [];
  const imagesRaw = Array.isArray(raw.images) ? raw.images : [];
  const images = imagesRaw.map((b64) =>
    typeof b64 === "string" && b64 ? base64ToBytes(b64) : new Uint8Array()
  );
  while (images.length < names.length) images.push(new Uint8Array());
  return {
    number: Number(raw.number) || 0,
    note: String(raw.note ?? ""),
    created: String(raw.created ?? ""),
    imageNames: names,
    images: images.slice(0, names.length)
  };
}

function deserializeSection(raw: SerializedSection): SectionState {
  return {
    entry: deserializeEntry(raw.entry),
    libraryId: raw.libraryId ?? null,
    placeholderValues: { ...(raw.placeholderValues ?? {}) },
    headingLine: String(raw.headingLine ?? ""),
    crossrefSection:
      raw.crossrefSection == null ? null : Number(raw.crossrefSection),
    text: String(raw.text ?? ""),
    source: (raw.source as TextSource) || "empty",
    needsAttention: Boolean(raw.needsAttention),
    pendingReview: Boolean(raw.pendingReview),
    pendingNoteConfirm: Boolean(raw.pendingNoteConfirm),
    suggestions: Array.isArray(raw.suggestions)
      ? raw.suggestions.map(String)
      : []
  };
}

export function projectFileNameFromDocx(docxName: string): string {
  const base = docxName.replace(/\.docx$/i, "").trim() || "survey-report";
  return `${base}${PROJECT_EXT}`;
}

export function buildReportProject(input: {
  sections: SectionState[];
  metadata: ReportMetadata;
  extras: ReportExtras;
  warnings?: string[];
  fileName: string;
  step?: ProjectStep;
  sourceFingerprint?: string;
}): ReportProject {
  return {
    kind: PROJECT_KIND,
    version: PROJECT_VERSION,
    savedAt: Date.now(),
    step: input.step ?? "details",
    fileName: input.fileName.trim() || "survey-report.docx",
    ...(input.sourceFingerprint
      ? { sourceFingerprint: input.sourceFingerprint }
      : {}),
    sections: input.sections,
    metadata: input.metadata,
    extras: input.extras,
    warnings: input.warnings ? [...input.warnings] : []
  };
}

/** Encode a project to the proprietary `.dmsr` blob. */
export function encodeReportProject(project: ReportProject): Blob {
  const payload: SerializedProject = {
    kind: PROJECT_KIND,
    version: PROJECT_VERSION,
    savedAt: project.savedAt,
    step: project.step,
    fileName: project.fileName,
    ...(project.sourceFingerprint
      ? { sourceFingerprint: project.sourceFingerprint }
      : {}),
    sections: project.sections.map(serializeSection),
    metadata: project.metadata,
    extras: project.extras,
    warnings: [...project.warnings]
  };
  return new Blob([JSON.stringify(payload)], { type: PROJECT_MIME });
}

export function isReportProject(value: unknown): value is SerializedProject {
  if (!value || typeof value !== "object") return false;
  const v = value as SerializedProject;
  return (
    v.kind === PROJECT_KIND &&
    typeof v.version === "number" &&
    Array.isArray(v.sections) &&
    v.metadata != null &&
    typeof v.metadata === "object" &&
    v.extras != null &&
    typeof v.extras === "object"
  );
}

/** Decode a proprietary project blob back into live app state. */
export async function decodeReportProject(blob: Blob): Promise<ReportProject> {
  const text = await blob.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("This file is not a valid DampMaster survey project.");
  }
  if (!isReportProject(parsed)) {
    throw new Error("This file is not a DampMaster survey project.");
  }
  if (parsed.version > PROJECT_VERSION) {
    throw new Error(
      "This project was saved by a newer version of the app and cannot be opened here."
    );
  }
  return {
    kind: PROJECT_KIND,
    version: parsed.version,
    savedAt: Number(parsed.savedAt) || Date.now(),
    step: parsed.step === "review" ? "review" : "details",
    fileName: String(parsed.fileName || "survey-report.docx"),
    ...(typeof parsed.sourceFingerprint === "string" && parsed.sourceFingerprint
      ? { sourceFingerprint: parsed.sourceFingerprint }
      : {}),
    sections: parsed.sections.map(deserializeSection),
    metadata: parsed.metadata,
    extras: parsed.extras,
    warnings: Array.isArray(parsed.warnings)
      ? parsed.warnings.map(String)
      : []
  };
}
