import type { AiConfig } from "../claude";

function tutorialOpenRouterKey(): string {
  return import.meta.env.VITE_TUTORIAL_OPENROUTER_KEY ?? "";
}

type OrModel = {
  id: string;
  pricing?: { prompt?: string; completion?: string };
  supported_parameters?: string[];
  top_provider?: { throughput?: number };
};

let cached: AiConfig | null = null;
let inflight: Promise<AiConfig> | null = null;

function isFree(m: OrModel): boolean {
  const p = Number(m.pricing?.prompt ?? 1);
  const c = Number(m.pricing?.completion ?? 1);
  if (p === 0 && c === 0) return true;
  return /:free$/i.test(m.id);
}

function score(m: OrModel): number {
  const params = m.supported_parameters ?? [];
  const reasoning =
    params.includes("reasoning") || params.includes("include_reasoning")
      ? 2000
      : /reason|think/i.test(m.id)
        ? 800
        : 0;
  const tps = Number(m.top_provider?.throughput ?? 0);
  return reasoning + tps;
}

export async function tutorialAiConfig(): Promise<AiConfig> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const key = tutorialOpenRouterKey();
      const res = await fetch("https://openrouter.ai/api/v1/models", {
        headers: {
          Authorization: `Bearer ${key}`,
          "HTTP-Referer":
            typeof window !== "undefined" ? window.location.origin : "",
          "X-Title": "DampMaster Report Studio tutorial"
        }
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { data?: OrModel[] };
      const free = (data.data ?? []).filter(isFree);
      free.sort((a, b) => score(b) - score(a));
      const id = free[0]?.id || "openrouter/auto";
      cached = {
        provider: "openrouter",
        apiKey: key,
        model: id
      };
      return cached;
    } catch {
      cached = {
        provider: "openrouter",
        apiKey: tutorialOpenRouterKey(),
        model: "openrouter/auto"
      };
      return cached;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
