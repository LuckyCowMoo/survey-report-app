/**
 * General API-cost estimate for a typical heavy report:
 * 25 photo sections (Ask AI) + one details-suggestions pass.
 *
 * Uses fixed usage assumptions × resolved $/MTok rates for the selected
 * model(s). Rates come from live provider data when available, otherwise
 * from provider/family heuristics — not hand-tuned per-model story estimates.
 */

export interface TokenRates {
  /** USD per 1,000,000 input tokens. */
  inputPerMTokUsd: number;
  /** USD per 1,000,000 output tokens. */
  outputPerMTokUsd: number;
  /** Where the rates came from (for the Settings hint). */
  source: "live" | "heuristic";
}

/** Assumed token shape for one Ask-AI section call with a photo. */
export const SECTION_USAGE = {
  /** Claude-style visual tokens for a ~1024px JPEG. */
  imageInputTokens: 1_300,
  /** System + library candidates + note + earlier-section summaries. */
  textInputTokens: 2_800,
  /** Short JSON / library pick / bespoke paragraph. */
  outputTokens: 280
} as const;

/** Assumed token shape for one full details-suggestions call (text only). */
export const DETAILS_USAGE = {
  textInputTokens: 12_000,
  outputTokens: 1_500
} as const;

export const COST_SCENARIO_SECTION_COUNT = 25;

/** Rough USD→GBP for display (not live FX). */
export const USD_TO_GBP = 0.75;

export function tokensToUsd(
  inputTokens: number,
  outputTokens: number,
  rates: TokenRates
): number {
  return (
    (inputTokens / 1_000_000) * rates.inputPerMTokUsd +
    (outputTokens / 1_000_000) * rates.outputPerMTokUsd
  );
}

export function estimateSectionsUsd(
  rates: TokenRates,
  sectionCount = COST_SCENARIO_SECTION_COUNT
): number {
  const inPer =
    SECTION_USAGE.imageInputTokens + SECTION_USAGE.textInputTokens;
  return (
    sectionCount *
    tokensToUsd(inPer, SECTION_USAGE.outputTokens, rates)
  );
}

export function estimateDetailsUsd(rates: TokenRates): number {
  return tokensToUsd(
    DETAILS_USAGE.textInputTokens,
    DETAILS_USAGE.outputTokens,
    rates
  );
}

export function estimateReportScenarioUsd(
  sectionRates: TokenRates,
  detailsRates: TokenRates,
  sectionCount = COST_SCENARIO_SECTION_COUNT
): { sectionsUsd: number; detailsUsd: number; totalUsd: number } {
  const sectionsUsd = estimateSectionsUsd(sectionRates, sectionCount);
  const detailsUsd = estimateDetailsUsd(detailsRates);
  return {
    sectionsUsd,
    detailsUsd,
    totalUsd: sectionsUsd + detailsUsd
  };
}

export function formatGbpFromUsd(usd: number): string {
  const gbp = usd * USD_TO_GBP;
  if (!Number.isFinite(gbp) || gbp < 0) return "—";
  if (gbp < 0.005) return "under 1p";
  if (gbp < 0.1) return `~${Math.max(1, Math.round(gbp * 100))}p`;
  if (gbp < 1) return `~£${gbp.toFixed(2)}`;
  if (gbp < 10) return `~£${gbp.toFixed(2)}`;
  return `~£${gbp.toFixed(1)}`;
}

export function formatUsdRates(rates: TokenRates): string {
  const inR = rates.inputPerMTokUsd;
  const outR = rates.outputPerMTokUsd;
  const fmt = (n: number) =>
    n < 0.1 ? n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "") : n.toFixed(2);
  return `$${fmt(inR)} / $${fmt(outR)} per 1M in/out`;
}
