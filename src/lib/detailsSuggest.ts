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

export interface DetailsSuggestResult {
  dampIssues?: {
    risingDamp?: boolean;
    penetratingDamp?: boolean;
    condensation?: boolean;
  };
  recommendationIds?: string[];
  costs?: Array<{
    itemId: string;
    /** Areas/rooms where this work applies, when relevant. */
    location?: string;
  }>;
}

const ISSUE_KEYS = ["risingDamp", "penetratingDamp", "condensation"] as const;
const REC_IDS = new Set(library.recommendations.map((r) => r.id));
const COST_IDS = new Set(library.costItems.map((c) => c.id));

const SYSTEM_PROMPT = `You are the recommendations assistant for DampMaster, a UK damp and timber surveying firm.

You read the survey section text already written for a property and decide which standard Issues, Recommendations, and billed Cost items should be ticked.

Rules:
- Use ONLY the allowed ids provided. Never invent ids.
- Never suggest an "Other" option.
- Prefer diagnoses supported by clear signs in the section text (see the operations mapping).
- For Rising Damp plaster work you MAY suggest both replaster and plasterboard when appropriate; the surveyor will choose.
- For Penetrating Damp exterior envelope failures, suggest recommendations only — do not invent billed costs for external repairs.
- For cost items that need a place of work, include a short "location" string (rooms/areas), e.g. "rear reception and hallway exterior walls to 1.2m".
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
      ? "Fill dampIssues, recommendationIds, and costs."
      : scope === "issues"
        ? 'Return ONLY {"dampIssues":{...}} — omit recommendationIds and costs.'
        : scope === "recommendations"
          ? 'Return ONLY {"recommendationIds":["rec-…"]} — omit dampIssues and costs.'
          : 'Return ONLY {"costs":[{"itemId":"cost-…","location":"…"}]} — omit dampIssues and recommendationIds.';

  const example =
    scope === "issues"
      ? '{"dampIssues":{"risingDamp":false,"penetratingDamp":false,"condensation":true}}'
      : scope === "recommendations"
        ? '{"recommendationIds":["rec-piv","rec-mould-removal"]}'
        : scope === "costs"
          ? '{"costs":[{"itemId":"cost-piv-unit","location":"whole dwelling"},{"itemId":"cost-mould-treatment","location":"front bedroom external wall"}]}'
          : '{"dampIssues":{"risingDamp":false,"penetratingDamp":false,"condensation":true},"recommendationIds":["rec-piv"],"costs":[{"itemId":"cost-piv-unit","location":"whole dwelling"},{"itemId":"cost-mould-treatment","location":"front bedroom external wall"}]}';

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
    "Omit keys outside the requested scope. Only include true issue flags you want ticked."
  );
  return parts.join("\n");
}

/** Normalise common model shapes into the expected object keys. */
function coerceSuggestionsPayload(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw };

  if (!Array.isArray(out.recommendationIds)) {
    const alt =
      out.recommendations ??
      out.recommendation_ids ??
      out.recommendationID ??
      out.recs;
    if (Array.isArray(alt)) out.recommendationIds = alt;
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
    return { recommendationIds: arr };
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
    const dampIssues: DetailsSuggestResult["dampIssues"] = {};
    for (const key of ISSUE_KEYS) {
      if (issuesRaw[key] === true) dampIssues[key] = true;
    }
    if (Object.keys(dampIssues).length) out.dampIssues = dampIssues;
  }

  if (scope === "all" || scope === "recommendations") {
    const ids = Array.isArray(raw.recommendationIds)
      ? raw.recommendationIds
      : [];
    const recommendationIds: string[] = [];
    for (const id of ids) {
      if (typeof id === "string" && REC_IDS.has(id)) {
        recommendationIds.push(id);
        continue;
      }
      if (id && typeof id === "object") {
        const nested = (id as { id?: unknown }).id;
        if (typeof nested === "string" && REC_IDS.has(nested)) {
          recommendationIds.push(nested);
        }
      }
    }
    const unique = [...new Set(recommendationIds)];
    if (unique.length) out.recommendationIds = unique;
  }

  if (scope === "all" || scope === "costs") {
    const costsRaw = Array.isArray(raw.costs) ? raw.costs : [];
    const costs: NonNullable<DetailsSuggestResult["costs"]> = [];
    for (const row of costsRaw) {
      if (!row || typeof row !== "object") continue;
      const itemId = (row as { itemId?: unknown }).itemId;
      if (typeof itemId !== "string" || !COST_IDS.has(itemId)) continue;
      const locationRaw = (row as { location?: unknown }).location;
      const location =
        typeof locationRaw === "string" ? locationRaw.trim() : "";
      costs.push(location ? { itemId, location } : { itemId });
    }
    // Dedupe by itemId, last wins for location.
    const byId = new Map<string, { itemId: string; location?: string }>();
    for (const c of costs) byId.set(c.itemId, c);
    if (byId.size) out.costs = [...byId.values()];
  }

  return out;
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
  return sanitizeResult(parsed, scope);
}

let costIdCounter = 1;

/** Apply a suggestions result onto ReportExtras (does not touch Other fields). */
export function applyDetailsSuggestions(
  extras: ReportExtras,
  suggestion: DetailsSuggestResult,
  scope: DetailsSuggestScope
): ReportExtras {
  let next: ReportExtras = { ...extras };

  if ((scope === "all" || scope === "issues") && suggestion.dampIssues) {
    next = {
      ...next,
      dampIssues: {
        ...next.dampIssues,
        risingDamp: Boolean(suggestion.dampIssues.risingDamp),
        penetratingDamp: Boolean(suggestion.dampIssues.penetratingDamp),
        condensation: Boolean(suggestion.dampIssues.condensation)
        // never touch other
      }
    };
  }

  if ((scope === "all" || scope === "recommendations") && suggestion.recommendationIds) {
    next = {
      ...next,
      recommendationIds: [...suggestion.recommendationIds]
      // never touch otherRecommendation*
    };
  }

  if ((scope === "all" || scope === "costs") && suggestion.costs) {
    const lines: CostLine[] = [];
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
    }
    next = {
      ...next,
      costLines: lines
      // never touch otherCost*
    };
  }

  return next;
}
