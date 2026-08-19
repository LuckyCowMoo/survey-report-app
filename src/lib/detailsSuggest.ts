/**
 * Suggest issues / recommendations / billed cost items from section text,
 * using the DampMaster operations mapping.
 */
import opsMapping from "../data/recommendationOps.json";
import { library } from "./matcher";
import {
  callAiText,
  extractJsonArray,
  extractJsonObject,
  type AiConfig
} from "./claude";
import type { CostLine, ReportExtras, SectionState } from "../types";

export type DetailsSuggestScope = "all" | "issues" | "recommendations" | "costs";

export type IssueSuggestKey = "risingDamp" | "penetratingDamp" | "condensation";

export interface DetailsSuggestResult {
  dampIssues?: Partial<Record<IssueSuggestKey, boolean>>;
  issueReasons?: Partial<Record<IssueSuggestKey, string>>;
  recommendationIds?: string[];
  recommendationReasons?: Record<string, string>;
  costs?: Array<{
    itemId: string;
    /** Areas/rooms where this work applies, when relevant. */
    location?: string;
    reason?: string;
  }>;
}

const ISSUE_KEYS: IssueSuggestKey[] = [
  "risingDamp",
  "penetratingDamp",
  "condensation"
];
const REC_IDS = new Set(library.recommendations.map((r) => r.id));
const COST_IDS = new Set(library.costItems.map((c) => c.id));

/** Whole-property / unit-priced items — no room/area location is required. */
const COST_NO_LOCATION = new Set([
  "cost-waste-removal",
  "cost-piv-unit",
  "cost-loft-insulation",
  "cost-ulv-fogging",
  "cost-electro-osmosis",
  "cost-ozonation",
  "cost-flood-drying"
]);

export function costItemNeedsLocation(itemId: string): boolean {
  if (itemId === "custom" || itemId === "other") return false;
  return !COST_NO_LOCATION.has(itemId);
}

const SYSTEM_PROMPT = `You are the recommendations assistant for DampMaster, a UK damp and timber surveying firm.

You read the survey section text already written for a property and decide which standard Issues, Recommendations, and billed Cost items should be ticked.

Rules:
- Use ONLY the allowed ids provided. Never invent ids.
- Never suggest an "Other" option.
- Prefer diagnoses supported by clear signs in the section text (see the operations mapping).
- For Rising Damp plaster work you MAY suggest both replaster and plasterboard when appropriate; the surveyor will choose.
- For Penetrating Damp exterior envelope failures, suggest recommendations only — do not invent billed costs for external repairs.
- For cost items that need a place of work, include a short "location" string (rooms/areas), e.g. "rear reception and hallway exterior walls to 1.2m".
- For every tick you select, include a short "reason" (one sentence) citing the survey evidence that justified it.
- Do not write project-plan prose paragraphs — only tick cost items (with optional locations).
- Respond with ONLY a JSON object, no markdown fences, no commentary.`;

function sectionCorpus(sections: SectionState[]): string {
  return sections
    .map((s) => {
      const head = s.headingLine?.trim()
        ? ` (${s.headingLine.trim()})`
        : "";
      const note = s.entry.note?.trim() ? `\nField note: ${s.entry.note.trim()}` : "";
      const body = s.text?.trim() || "(no text yet)";
      return `Section ${s.entry.number}${head}:${note}\n${body}`;
    })
    .join("\n\n");
}

function buildUserPrompt(sections: SectionState[], scope: DetailsSuggestScope): string {
  const wantIssues = scope === "all" || scope === "issues";
  const wantRecs = scope === "all" || scope === "recommendations";
  const wantCosts = scope === "all" || scope === "costs";

  const recList = library.recommendations
    .map((r) => `- ${r.id}: ${r.label}`)
    .join("\n");
  const costList = library.costItems
    .map((c) => `- ${c.id}: ${c.label}`)
    .join("\n");
  const ops = (opsMapping as Array<Record<string, unknown>>)
    .map((row) => {
      const issue = row.issueKey ? ` issueKey=${row.issueKey}` : "";
      const lines = [`### ${row.diagnosis} (${row.id})${issue}`, `Signs: ${row.signs}`];
      if (wantRecs) {
        lines.push(
          `Recommendations: ${(row.recommendationIds as string[]).join(", ") || "(none)"}`
        );
      }
      if (wantCosts) {
        lines.push(`Costs: ${(row.costItemIds as string[]).join(", ") || "(none)"}`);
      }
      if (row.notes) lines.push(`Notes: ${row.notes}`);
      return lines.join("\n");
    })
    .join("\n\n");

  const scopeHint =
    scope === "all"
      ? "Fill dampIssues, recommendations, and costs — each selected item needs a reason."
      : scope === "issues"
        ? "Return ONLY dampIssues (omit recommendations and costs)."
        : scope === "recommendations"
          ? "Return ONLY recommendations (omit dampIssues and costs)."
          : "Return ONLY costs (omit dampIssues and recommendations).";

  const example =
    scope === "issues"
      ? '{"dampIssues":{"condensation":{"selected":true,"reason":"Black mould and high RH noted on external bedroom walls"}}}'
      : scope === "recommendations"
        ? '{"recommendations":[{"id":"rec-piv","reason":"Widespread condensation; whole-house ventilation indicated"},{"id":"rec-mould-removal","reason":"Visible mould growth on external walls"}]}'
        : scope === "costs"
          ? '{"costs":[{"itemId":"cost-piv-unit","location":"whole dwelling","reason":"PIV recommended for atmospheric moisture control"},{"itemId":"cost-mould-treatment","location":"front bedroom external wall","reason":"Local mould treatment where staining was recorded"}]}'
          : '{"dampIssues":{"condensation":{"selected":true,"reason":"Elevated RH and mould in living areas"}},"recommendations":[{"id":"rec-piv","reason":"Condensation throughout; PIV indicated"}],"costs":[{"itemId":"cost-piv-unit","location":"whole dwelling","reason":"Matches PIV recommendation"}]}';

  const parts = [
    `SCOPE: ${scopeHint}`,
    "",
    "OPERATIONS MAPPING (signs → outputs):",
    ops,
    ""
  ];
  if (wantIssues) {
    parts.push("ALLOWED ISSUE KEYS: risingDamp, penetratingDamp, condensation", "");
  }
  if (wantRecs) {
    parts.push("ALLOWED RECOMMENDATION IDS:", recList, "");
  }
  if (wantCosts) {
    parts.push("ALLOWED COST ITEM IDS:", costList, "");
  }
  parts.push(
    "SURVEY SECTIONS:",
    sectionCorpus(sections),
    "",
    "Return JSON shaped like:",
    example,
    "Only include items you want ticked. Every selected item must include a short reason."
  );
  return parts.join("\n");
}

function asReason(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ");
}

function parseIssueEntry(raw: unknown): { selected: boolean; reason: string } {
  if (raw === true) return { selected: true, reason: "" };
  if (raw === false || raw == null) return { selected: false, reason: "" };
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t || /^false$/i.test(t)) return { selected: false, reason: "" };
    if (/^true$/i.test(t)) return { selected: true, reason: "" };
    // Model sometimes returns the reason string directly.
    return { selected: true, reason: asReason(t) };
  }
  if (typeof raw !== "object") return { selected: false, reason: "" };
  const o = raw as Record<string, unknown>;
  const selected =
    o.selected === true ||
    o.tick === true ||
    o.value === true ||
    o.checked === true ||
    // `{ "reason": "..." }` with no selected flag still means pick it.
    (typeof o.reason === "string" && o.selected !== false && o.tick !== false);
  const reason = asReason(o.reason ?? o.why ?? o.rationale ?? o.explanation);
  return { selected: Boolean(selected), reason };
}

function parseRecEntry(raw: unknown): { id: string; reason: string } | null {
  if (typeof raw === "string" && REC_IDS.has(raw)) {
    return { id: raw, reason: "" };
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id =
    typeof o.id === "string"
      ? o.id
      : typeof o.recommendationId === "string"
        ? o.recommendationId
        : "";
  if (!REC_IDS.has(id)) return null;
  return { id, reason: asReason(o.reason ?? o.why ?? o.rationale ?? o.explanation) };
}

/** Normalise common model shapes into the expected object keys. */
function coerceSuggestionsPayload(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw };

  if (!Array.isArray(out.recommendations) && !Array.isArray(out.recommendationIds)) {
    const alt =
      out.recommendation_ids ??
      out.recommendationID ??
      out.recs;
    if (Array.isArray(alt)) out.recommendations = alt;
  }

  if (!out.dampIssues || typeof out.dampIssues !== "object") {
    const alt = out.issues ?? out.damp_issues;
    if (alt && typeof alt === "object") out.dampIssues = alt;
  }

  if (!Array.isArray(out.costs)) {
    const alt = out.costItems ?? out.cost_items ?? out.costLines;
    if (Array.isArray(alt)) out.costs = alt;
  }

  return out;
}

function parseSuggestionsResponse(rawText: string): Record<string, unknown> | null {
  const obj = extractJsonObject(rawText);
  if (obj) return coerceSuggestionsPayload(obj);

  // Some models return a bare id array for recommendations-only.
  const arr = extractJsonArray(rawText);
  if (arr && arr.length > 0 && arr.every((x) => typeof x === "string")) {
    return { recommendations: arr };
  }
  return null;
}

function sanitizeResult(
  raw: Record<string, unknown>,
  scope: DetailsSuggestScope
): DetailsSuggestResult {
  const out: DetailsSuggestResult = {};

  if (scope === "all" || scope === "issues") {
    const issuesRaw = (raw.dampIssues ?? {}) as Record<string, unknown>;
    const dampIssues: NonNullable<DetailsSuggestResult["dampIssues"]> = {};
    const issueReasons: NonNullable<DetailsSuggestResult["issueReasons"]> = {};
    for (const key of ISSUE_KEYS) {
      const parsed = parseIssueEntry(issuesRaw[key]);
      if (!parsed.selected) continue;
      dampIssues[key] = true;
      if (parsed.reason) issueReasons[key] = parsed.reason;
    }
    if (Object.keys(dampIssues).length) {
      out.dampIssues = dampIssues;
      if (Object.keys(issueReasons).length) out.issueReasons = issueReasons;
    }
  }

  if (scope === "all" || scope === "recommendations") {
    const list = Array.isArray(raw.recommendations)
      ? raw.recommendations
      : Array.isArray(raw.recommendationIds)
        ? raw.recommendationIds
        : [];
    const recommendationIds: string[] = [];
    const recommendationReasons: Record<string, string> = {};
    for (const entry of list) {
      const parsed = parseRecEntry(entry);
      if (!parsed) continue;
      if (!recommendationIds.includes(parsed.id)) recommendationIds.push(parsed.id);
      if (parsed.reason) recommendationReasons[parsed.id] = parsed.reason;
    }
    if (recommendationIds.length) {
      out.recommendationIds = recommendationIds;
      if (Object.keys(recommendationReasons).length) {
        out.recommendationReasons = recommendationReasons;
      }
    }
  }

  if (scope === "all" || scope === "costs") {
    const costsRaw = Array.isArray(raw.costs) ? raw.costs : [];
    const costs: NonNullable<DetailsSuggestResult["costs"]> = [];
    for (const row of costsRaw) {
      if (!row || typeof row !== "object") continue;
      const itemIdRaw = (row as { itemId?: unknown; id?: unknown }).itemId
        ?? (row as { id?: unknown }).id;
      if (typeof itemIdRaw !== "string" || !COST_IDS.has(itemIdRaw)) continue;
      const locationRaw = (row as { location?: unknown }).location;
      const location =
        typeof locationRaw === "string" ? locationRaw.trim() : "";
      const reason = asReason(
        (row as { reason?: unknown; why?: unknown }).reason
          ?? (row as { why?: unknown }).why
      );
      costs.push({
        itemId: itemIdRaw,
        ...(location ? { location } : {}),
        ...(reason ? { reason } : {})
      });
    }
    // Dedupe by itemId, last wins for location/reason.
    const byId = new Map<string, NonNullable<DetailsSuggestResult["costs"]>[number]>();
    for (const c of costs) byId.set(c.itemId, c);
    if (byId.size) out.costs = [...byId.values()];
  }

  return out;
}

function cloneSuggestResult(result: DetailsSuggestResult): DetailsSuggestResult {
  return JSON.parse(JSON.stringify(result)) as DetailsSuggestResult;
}

function mergeSuggestResults(
  issues: DetailsSuggestResult,
  recommendations: DetailsSuggestResult,
  costs: DetailsSuggestResult
): DetailsSuggestResult {
  return {
    ...(issues.dampIssues ? { dampIssues: issues.dampIssues } : {}),
    ...(issues.issueReasons ? { issueReasons: issues.issueReasons } : {}),
    ...(recommendations.recommendationIds
      ? { recommendationIds: recommendations.recommendationIds }
      : {}),
    ...(recommendations.recommendationReasons
      ? { recommendationReasons: recommendations.recommendationReasons }
      : {}),
    ...(costs.costs ? { costs: costs.costs } : {})
  };
}

function fingerprintSections(sections: SectionState[]): string {
  // Stable hash of the survey wording that drives suggestions.
  const corpus = sectionCorpus(sections);
  let hash = 2166136261;
  for (let i = 0; i < corpus.length; i++) {
    hash ^= corpus.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function suggestCacheKey(
  sections: SectionState[],
  ai: AiConfig,
  scope: Exclude<DetailsSuggestScope, "all"> | "all"
): string {
  return `${ai.provider}|${ai.model}|${scope}|${fingerprintSections(sections)}`;
}

/** In-memory cache: same survey wording + model + scope → reuse prior answer. */
const suggestCache = new Map<string, DetailsSuggestResult>();

async function fetchScopedSuggestion(
  sections: SectionState[],
  ai: AiConfig,
  scope: Exclude<DetailsSuggestScope, "all">,
  signal?: AbortSignal
): Promise<DetailsSuggestResult> {
  const key = suggestCacheKey(sections, ai, scope);
  const cached = suggestCache.get(key);
  if (cached) return cloneSuggestResult(cached);

  signal?.throwIfAborted?.();
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const rawText = await callAiText(
    ai,
    buildUserPrompt(sections, scope),
    SYSTEM_PROMPT,
    signal
  );
  if (!rawText.trim()) {
    throw new Error("The AI returned an empty suggestions response.");
  }
  const parsed = parseSuggestionsResponse(rawText);
  if (!parsed) {
    throw new Error("The AI returned an unreadable suggestions response.");
  }
  const result = sanitizeResult(parsed, scope);
  suggestCache.set(key, cloneSuggestResult(result));
  // Combined "all" answer is stale once any part is refreshed.
  suggestCache.delete(suggestCacheKey(sections, ai, "all"));
  return cloneSuggestResult(result);
}

export async function suggestDetailsExtras(
  sections: SectionState[],
  ai: AiConfig,
  scope: DetailsSuggestScope = "all",
  signal?: AbortSignal
): Promise<DetailsSuggestResult> {
  if (!ai.apiKey.trim()) {
    throw new Error("Add your AI API key in Settings first.");
  }
  if (sections.length === 0) {
    throw new Error("No sections available to analyse.");
  }

  if (scope !== "all") {
    return fetchScopedSuggestion(sections, ai, scope, signal);
  }

  const allKey = suggestCacheKey(sections, ai, "all");
  const cachedAll = suggestCache.get(allKey);
  if (cachedAll) return cloneSuggestResult(cachedAll);

  // Run as three smaller calls (more reliable than one huge JSON payload).
  // Reuse any scope already answered for this same survey wording.
  const scopes: Array<Exclude<DetailsSuggestScope, "all">> = [
    "issues",
    "recommendations",
    "costs"
  ];
  const parts: Partial<
    Record<Exclude<DetailsSuggestScope, "all">, DetailsSuggestResult>
  > = {};
  const errors: string[] = [];

  for (const part of scopes) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      parts[part] = await fetchScopedSuggestion(sections, ai, part, signal);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      errors.push(
        `${part}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  if (!parts.issues && !parts.recommendations && !parts.costs) {
    throw new Error(
      errors[0] || "The AI returned an unreadable suggestions response."
    );
  }

  const merged = mergeSuggestResults(
    parts.issues ?? {},
    parts.recommendations ?? {},
    parts.costs ?? {}
  );

  if (parts.issues && parts.recommendations && parts.costs) {
    suggestCache.set(allKey, cloneSuggestResult(merged));
  }

  if (errors.length) {
    throw new PartialDetailsSuggestError(
      `Some suggestions failed (${errors.join("; ")}). Successful parts were kept — try again for the rest.`,
      merged
    );
  }

  return merged;
}

/** Thrown when Ask-all got some scopes back but not all. */
export class PartialDetailsSuggestError extends Error {
  readonly result: DetailsSuggestResult;

  constructor(message: string, result: DetailsSuggestResult) {
    super(message);
    this.name = "PartialDetailsSuggestError";
    this.result = result;
  }
}

let costIdCounter = 1;

export function emptyAiSuggested(): ReportExtras["aiSuggested"] {
  return {
    issues: {
      risingDamp: false,
      penetratingDamp: false,
      condensation: false
    },
    issueReasons: {},
    recommendationIds: [],
    recommendationReasons: {},
    costItemIds: [],
    costReasons: {}
  };
}

function cleanReasonMap(
  value: unknown
): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, reason] of Object.entries(value as Record<string, unknown>)) {
    const text = asReason(reason);
    if (key && text) out[key] = text;
  }
  return out;
}

/** Ensure older saved extras still have aiSuggested tracking fields. */
export function normalizeReportExtras(extras: ReportExtras): ReportExtras {
  const ai = extras.aiSuggested;
  const issueReasons = cleanReasonMap(ai?.issueReasons);
  return {
    ...extras,
    excludePlanCosts: Boolean(extras.excludePlanCosts),
    postProjectCleanup:
      typeof extras.postProjectCleanup === "string"
        ? extras.postProjectCleanup
        : "",
    invasiveSurvey: Boolean(extras.invasiveSurvey),
    aiSuggested: {
      issues: {
        risingDamp: Boolean(ai?.issues?.risingDamp),
        penetratingDamp: Boolean(ai?.issues?.penetratingDamp),
        condensation: Boolean(ai?.issues?.condensation)
      },
      issueReasons: {
        ...(issueReasons.risingDamp
          ? { risingDamp: issueReasons.risingDamp }
          : {}),
        ...(issueReasons.penetratingDamp
          ? { penetratingDamp: issueReasons.penetratingDamp }
          : {}),
        ...(issueReasons.condensation
          ? { condensation: issueReasons.condensation }
          : {})
      },
      recommendationIds: Array.isArray(ai?.recommendationIds)
        ? ai.recommendationIds.filter((id): id is string => typeof id === "string")
        : [],
      recommendationReasons: cleanReasonMap(ai?.recommendationReasons),
      costItemIds: Array.isArray(ai?.costItemIds)
        ? ai.costItemIds.filter((id): id is string => typeof id === "string")
        : [],
      costReasons: cleanReasonMap(ai?.costReasons)
    }
  };
}

/** Apply a suggestions result onto ReportExtras (does not touch Other fields). */
export function applyDetailsSuggestions(
  extras: ReportExtras,
  suggestion: DetailsSuggestResult,
  scope: DetailsSuggestScope
): ReportExtras {
  let next: ReportExtras = normalizeReportExtras(extras);
  const aiSuggested: ReportExtras["aiSuggested"] = {
    ...next.aiSuggested,
    issues: { ...next.aiSuggested.issues },
    issueReasons: { ...next.aiSuggested.issueReasons },
    recommendationReasons: { ...next.aiSuggested.recommendationReasons },
    costReasons: { ...next.aiSuggested.costReasons }
  };

  if ((scope === "all" || scope === "issues") && suggestion.dampIssues) {
    const dampIssues = {
      ...next.dampIssues,
      risingDamp: Boolean(suggestion.dampIssues.risingDamp),
      penetratingDamp: Boolean(suggestion.dampIssues.penetratingDamp),
      condensation: Boolean(suggestion.dampIssues.condensation)
      // never touch other
    };
    aiSuggested.issues = {
      risingDamp: dampIssues.risingDamp,
      penetratingDamp: dampIssues.penetratingDamp,
      condensation: dampIssues.condensation
    };
    const issueReasons: ReportExtras["aiSuggested"]["issueReasons"] = {};
    for (const key of ISSUE_KEYS) {
      if (!dampIssues[key]) continue;
      const reason = suggestion.issueReasons?.[key]?.trim();
      if (reason) issueReasons[key] = reason;
    }
    aiSuggested.issueReasons = issueReasons;
    next = { ...next, dampIssues };
  }

  if ((scope === "all" || scope === "recommendations") && suggestion.recommendationIds) {
    const recommendationIds = [...suggestion.recommendationIds];
    aiSuggested.recommendationIds = [...recommendationIds];
    const recommendationReasons: Record<string, string> = {};
    for (const id of recommendationIds) {
      const reason = suggestion.recommendationReasons?.[id]?.trim();
      if (reason) recommendationReasons[id] = reason;
    }
    aiSuggested.recommendationReasons = recommendationReasons;
    next = {
      ...next,
      recommendationIds
      // never touch otherRecommendation*
    };
  }

  if ((scope === "all" || scope === "costs") && suggestion.costs) {
    const lines: CostLine[] = [];
    const costReasons: Record<string, string> = {};
    for (const c of suggestion.costs) {
      const item = library.costItems.find((x) => x.id === c.itemId);
      if (!item) continue;
      lines.push({
        id: `cost-${costIdCounter++}`,
        itemId: item.id,
        label: item.label,
        description: item.text,
        amount: "",
        ...(c.location ? { location: c.location } : {})
      });
      if (c.reason?.trim()) costReasons[item.id] = c.reason.trim();
    }
    aiSuggested.costItemIds = lines.map((l) => l.itemId);
    aiSuggested.costReasons = costReasons;
    next = {
      ...next,
      costLines: lines
      // never touch otherCost*
    };
  }

  return { ...next, aiSuggested };
}

/** True when every selected cost item has a price, and a location if that item needs one. */
export function detailsCostsComplete(extras: ReportExtras): boolean {
  if (extras.excludePlanCosts) return true;
  for (const line of extras.costLines) {
    const amount = line.amount.replace(/[£,\s]/g, "").trim();
    if (!amount) return false;
    if (costItemNeedsLocation(line.itemId) && !line.location?.trim()) return false;
  }
  if (extras.otherCost) {
    const amount = extras.otherCostAmount.replace(/[£,\s]/g, "").trim();
    if (!amount) return false;
  }
  return true;
}

export function detailsCostsBlockingReason(extras: ReportExtras): string | null {
  if (extras.excludePlanCosts) return null;
  if (detailsCostsComplete(extras)) return null;
  const missingPrice =
    extras.costLines.some((line) => !line.amount.replace(/[£,\s]/g, "").trim()) ||
    (extras.otherCost && !extras.otherCostAmount.replace(/[£,\s]/g, "").trim());
  const missingLocation = extras.costLines.some(
    (line) => costItemNeedsLocation(line.itemId) && !line.location?.trim()
  );

  const parts: string[] = [];
  if (missingPrice) parts.push("prices");
  if (missingLocation) parts.push("work locations");
  if (!parts.length) return "Fill in all required fields before generating.";
  return `Fill in all ${parts.join(" and ")} before generating.`;
}

export function detailsFirstIncompleteId(extras: ReportExtras): string | null {
  if (extras.excludePlanCosts) return null;
  for (const line of extras.costLines) {
    if (!line.amount.replace(/[£,\s]/g, "").trim()) return `cost-${line.id}-amount`;
    if (costItemNeedsLocation(line.itemId) && !line.location?.trim()) {
      return `cost-${line.id}-location`;
    }
  }
  if (extras.otherCost && !extras.otherCostAmount.replace(/[£,\s]/g, "").trim()) {
    return "cost-other-amount";
  }
  return null;
}

export async function suggestPostProjectCleanup(
  sections: SectionState[],
  extras: ReportExtras,
  cfg: AiConfig
): Promise<string> {
  const corpus = sectionCorpus(sections);
  const plan = extras.projectPlanLines.trim() || "(none written)";
  const costs = extras.costLines
    .map((l) => l.label || l.description)
    .filter(Boolean)
    .join("; ");
  const prompt = `You write one professional paragraph for a UK damp-survey report covering post-project clean-up and reinstatement.

It may mention items such as new skirting boards, decorating, removing and refitting radiators, and replacing ceiling coving where full-height wall treatment is needed — but only include what is relevant to THIS survey. Do not pad with generic boilerplate if the works do not need it.

Write plain British English, one or two paragraphs, no heading, no bullet points.

Project plan:
${plan}

Billed items: ${costs || "(none)"}

Survey sections:
${corpus}`;

  const raw = await callAiText(
    cfg,
    prompt,
    "You are a damp and timber surveyor writing report close-out notes."
  );
  return raw.trim();
}
