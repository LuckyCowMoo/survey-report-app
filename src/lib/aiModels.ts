/** Live + fallback model lists for Settings dropdowns (vision + text only). */

import type { AiProvider } from "./aiProviders";
import { AI_PROVIDERS, modelFitsProvider, providerInfo } from "./aiProviders";
import type { TokenRates } from "./aiCostEstimate";

export interface AiModelOption {
  id: string;
  label: string;
  /** USD/MTok rates when known (live catalog or heuristic). */
  rates?: TokenRates;
}

const CLAUDE_MODELS_URL = "https://api.anthropic.com/v1/models?limit=100";
const GEMINI_MODELS_URL =
  "https://generativelanguage.googleapis.com/v1beta/models?pageSize=100";

/** Used when the live list cannot be fetched — vision-capable chat models only. */
export const FALLBACK_MODELS: Record<AiProvider, AiModelOption[]> = {
  claude: [
    { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
    { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
    { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" }
  ],
  gemini: [
    { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash" },
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" }
  ],
  openai: [
    { id: "gpt-4.1-mini", label: "GPT-4.1 mini" },
    { id: "gpt-4.1", label: "GPT-4.1" },
    { id: "gpt-4o", label: "GPT-4o" },
    { id: "gpt-4o-mini", label: "GPT-4o mini" },
    { id: "o4-mini", label: "o4-mini" }
  ],
  xai: [
    { id: "grok-2-vision-1212", label: "Grok 2 Vision" },
    { id: "grok-3-mini", label: "Grok 3 Mini" },
    { id: "grok-3", label: "Grok 3" }
  ],
  groq: [
    {
      id: "meta-llama/llama-4-scout-17b-16e-instruct",
      label: "Llama 4 Scout (Groq)"
    },
    {
      id: "meta-llama/llama-4-maverick-17b-128e-instruct",
      label: "Llama 4 Maverick (Groq)"
    }
  ],
  openrouter: [
    { id: "openai/gpt-4.1-mini", label: "OpenAI GPT-4.1 mini" },
    { id: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4" },
    { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { id: "meta-llama/llama-4-scout", label: "Llama 4 Scout" }
  ],
  deepseek: [
    // Public DeepSeek chat endpoints are text-only; keep empty fallback.
  ],
  mistral: [
    { id: "pixtral-large-latest", label: "Pixtral Large" },
    { id: "mistral-small-latest", label: "Mistral Small" },
    { id: "mistral-medium-latest", label: "Mistral Medium" }
  ],
  together: [
    {
      id: "meta-llama/Llama-4-Scout-17B-16E-Instruct",
      label: "Llama 4 Scout"
    }
  ],
  fireworks: [
    {
      id: "accounts/fireworks/models/llama4-scout-instruct-basic",
      label: "Llama 4 Scout"
    }
  ]
};

export const FALLBACK_CLAUDE_MODELS = FALLBACK_MODELS.claude;
export const FALLBACK_GEMINI_MODELS = FALLBACK_MODELS.gemini;

function mergeOptions(
  live: AiModelOption[],
  fallback: AiModelOption[],
  selected?: string
): AiModelOption[] {
  const byId = new Map<string, AiModelOption>();
  for (const m of [...live, ...fallback]) {
    if (!byId.has(m.id)) byId.set(m.id, m);
    else {
      const prev = byId.get(m.id)!;
      byId.set(m.id, {
        ...prev,
        ...m,
        rates: m.rates ?? prev.rates,
        label: m.label || prev.label
      });
    }
  }
  if (selected?.trim() && !byId.has(selected.trim())) {
    const id = selected.trim();
    byId.set(id, {
      id,
      label: id,
      rates: resolveHeuristicRates(id) ?? undefined
    });
  }
  return [...byId.values()];
}

/** Drop embeddings, image generators, audio, etc. */
function isTextOutputLlm(id: string, provider: AiProvider): boolean {
  const n = id.toLowerCase().replace(/^models\//, "");
  const blocked = [
    "embedding",
    "embed-content",
    "text-embedding",
    "imagen",
    "image-generation",
    "imagepreview",
    "veo",
    "video",
    "tts",
    "asr",
    "audio",
    "speech",
    "aqa",
    "robotics",
    "whisper",
    "dall-e",
    "tts-",
    "moderation",
    "transcribe",
    "realtime",
    "computer-use"
  ];
  if (blocked.some((b) => n.includes(b))) return false;

  if (provider === "claude") return n.startsWith("claude");
  if (provider === "gemini") return n.startsWith("gemini");
  if (provider === "openai") {
    return (
      n.startsWith("gpt") ||
      n.startsWith("o1") ||
      n.startsWith("o3") ||
      n.startsWith("o4") ||
      n.startsWith("chatgpt")
    );
  }
  if (provider === "xai") return n.includes("grok");
  if (provider === "deepseek") return n.includes("deepseek");
  if (provider === "mistral") {
    return (
      n.includes("mistral") ||
      n.includes("mixtral") ||
      n.includes("pixtral") ||
      n.includes("codestral") ||
      n.includes("ministral")
    );
  }
  return true;
}

/**
 * Heuristic: model accepts image+text input and returns text.
 * Prefer live modality metadata when callers have it.
 */
export function supportsVisionTextChat(
  id: string,
  provider: AiProvider,
  meta?: { inputModalities?: string[]; outputModalities?: string[] }
): boolean {
  if (!isTextOutputLlm(id, provider)) return false;

  const inputs = (meta?.inputModalities ?? []).map((m) => m.toLowerCase());
  const outputs = (meta?.outputModalities ?? []).map((m) => m.toLowerCase());
  if (inputs.length > 0 || outputs.length > 0) {
    const inOk =
      inputs.includes("image") ||
      inputs.includes("file") ||
      inputs.includes("vision");
    const outOk =
      outputs.length === 0 ||
      outputs.includes("text") ||
      outputs.includes("output_text");
    // Reject image-generation-only models.
    if (outputs.includes("image") && !outputs.includes("text")) return false;
    return inOk && outOk;
  }

  const n = id.toLowerCase().replace(/^models\//, "");

  // Explicit vision markers.
  if (
    /vision|pixtral|llava|vl-|\/vl|gpt-4o|chatgpt-4o|llama-4|llama4|scout|maverick/.test(
      n
    )
  ) {
    return true;
  }

  switch (provider) {
    case "claude":
      // Claude 3+ chat models are multimodal.
      return /claude-(3|4|sonnet|opus|haiku)/.test(n) || n.startsWith("claude");
    case "gemini":
      return (
        n.startsWith("gemini") &&
        !n.includes("embedding") &&
        !n.includes("imagen") &&
        !n.includes("tts")
      );
    case "openai":
      return (
        /^gpt-4[o.\-]/.test(n) ||
        n.startsWith("gpt-4.1") ||
        n.startsWith("gpt-4-turbo") ||
        n.startsWith("chatgpt-4o") ||
        /^o[34]/.test(n)
      );
    case "xai":
      // Current Grok chat models accept images on xAI’s API.
      return n.includes("grok") && !n.includes("imagine");
    case "groq":
      return /llama-4|llama4|scout|maverick|llava|vision|pixtral/.test(n);
    case "openrouter":
      // Without architecture metadata, keep known multimodal families.
      return (
        /gpt-4o|gpt-4\.1|claude|gemini|llama-4|llama4|scout|maverick|pixtral|vision|llava|grok/.test(
          n
        ) && !/embedding|tts|whisper|dall-e|imagen/.test(n)
      );
    case "deepseek":
      return /vl|vision|janus/.test(n);
    case "mistral":
      return /pixtral|mistral-small|mistral-medium|mistral-large|ministral/.test(
        n
      );
    case "together":
    case "fireworks":
      return /llama-4|llama4|scout|maverick|llava|vision|pixtral|qwen.*vl/.test(
        n
      );
    default:
      return false;
  }
}

type PriceTier = "budget" | "standard" | "premium";

/** Provider list prices by rough capability tier (USD / MTok). */
const PROVIDER_TIER_RATES: Record<
  AiProvider,
  Record<PriceTier, { input: number; output: number }>
> = {
  claude: {
    budget: { input: 1, output: 5 },
    standard: { input: 2, output: 10 },
    premium: { input: 5, output: 25 }
  },
  gemini: {
    budget: { input: 0.15, output: 0.6 },
    standard: { input: 0.3, output: 2.5 },
    premium: { input: 1.25, output: 10 }
  },
  openai: {
    budget: { input: 0.4, output: 1.6 },
    standard: { input: 2, output: 8 },
    premium: { input: 5, output: 20 }
  },
  xai: {
    budget: { input: 0.3, output: 0.5 },
    standard: { input: 2, output: 10 },
    premium: { input: 5, output: 25 }
  },
  groq: {
    budget: { input: 0.11, output: 0.34 },
    standard: { input: 0.2, output: 0.6 },
    premium: { input: 0.5, output: 1.5 }
  },
  openrouter: {
    budget: { input: 0.15, output: 0.6 },
    standard: { input: 2, output: 10 },
    premium: { input: 5, output: 25 }
  },
  deepseek: {
    budget: { input: 0.28, output: 0.42 },
    standard: { input: 0.55, output: 2.19 },
    premium: { input: 1, output: 4 }
  },
  mistral: {
    budget: { input: 0.1, output: 0.3 },
    standard: { input: 0.4, output: 2 },
    premium: { input: 2, output: 6 }
  },
  together: {
    budget: { input: 0.18, output: 0.59 },
    standard: { input: 0.88, output: 0.88 },
    premium: { input: 1.2, output: 1.2 }
  },
  fireworks: {
    budget: { input: 0.15, output: 0.6 },
    standard: { input: 0.9, output: 0.9 },
    premium: { input: 1.2, output: 1.2 }
  }
};

function inferPriceTier(modelId: string): PriceTier {
  const n = modelId.toLowerCase();
  if (
    /haiku|flash-lite|flash|mini|small|8b|instant|scout|nano|lite/.test(n) &&
    !/pro|opus|large|maverick/.test(n)
  ) {
    return "budget";
  }
  if (/opus|pro(?!-)|o3|o1|fable|gpt-4\.1(?!-mini)|large|maverick/.test(n)) {
    return "premium";
  }
  return "standard";
}

/** Infer $/MTok from provider + model-id family (no per-model storytelling). */
export function resolveHeuristicRates(modelId: string): TokenRates | null {
  const id = modelId.trim();
  if (!id) return null;

  // Prefer matching a known provider family from the id itself.
  let provider: AiProvider | null = null;
  const lower = id.toLowerCase();
  if (lower.startsWith("claude") || lower.includes("anthropic/")) {
    provider = "claude";
  } else if (lower.startsWith("gemini") || lower.includes("google/")) {
    provider = "gemini";
  } else if (
    lower.startsWith("gpt-") ||
    lower.startsWith("o1") ||
    lower.startsWith("o3") ||
    lower.startsWith("o4") ||
    lower.startsWith("openai/")
  ) {
    provider = "openai";
  } else if (lower.includes("grok") || lower.startsWith("xai/")) {
    provider = "xai";
  } else if (lower.includes("deepseek")) {
    provider = "deepseek";
  } else if (
    lower.includes("mistral") ||
    lower.includes("pixtral") ||
    lower.includes("mixtral")
  ) {
    provider = "mistral";
  } else if (lower.includes("accounts/fireworks") || lower.includes("fireworks/")) {
    provider = "fireworks";
  } else if (lower.includes("llama") || lower.includes("meta-llama")) {
    provider = "together";
  }

  if (!provider) return null;
  const tier = inferPriceTier(id);
  const rates = PROVIDER_TIER_RATES[provider][tier];
  return {
    inputPerMTokUsd: rates.input,
    outputPerMTokUsd: rates.output,
    source: "heuristic"
  };
}

export function resolveRatesForProviderModel(
  provider: AiProvider,
  modelId: string,
  option?: AiModelOption | null
): TokenRates | null {
  if (option?.rates) return option.rates;
  const tier = inferPriceTier(modelId);
  const rates = PROVIDER_TIER_RATES[provider][tier];
  return {
    inputPerMTokUsd: rates.input,
    outputPerMTokUsd: rates.output,
    source: "heuristic"
  };
}

function withHeuristicRates(
  provider: AiProvider,
  models: AiModelOption[]
): AiModelOption[] {
  return models.map((m) => ({
    ...m,
    rates: m.rates ?? resolveRatesForProviderModel(provider, m.id) ?? undefined
  }));
}

function filterVisionModels(
  provider: AiProvider,
  models: AiModelOption[],
  metaById?: Map<string, { inputModalities?: string[]; outputModalities?: string[] }>
): AiModelOption[] {
  return models.filter((m) =>
    supportsVisionTextChat(m.id, provider, metaById?.get(m.id))
  );
}

async function listClaudeModels(apiKey: string): Promise<AiModelOption[]> {
  const res = await fetch(CLAUDE_MODELS_URL, {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    }
  });
  if (!res.ok) {
    throw new Error(`Claude models list failed (${res.status})`);
  }
  const data = (await res.json()) as {
    data?: Array<{
      id?: string;
      display_name?: string;
      type?: string;
      max_tokens?: number | null;
    }>;
  };
  return (data.data ?? [])
    .filter((m) => typeof m.id === "string" && m.id)
    .filter((m) => isTextOutputLlm(m.id as string, "claude"))
    .filter((m) => m.max_tokens == null || m.max_tokens > 0)
    .map((m) => ({
      id: m.id as string,
      label: m.display_name?.trim() || (m.id as string)
    }));
}

async function listGeminiModels(apiKey: string): Promise<AiModelOption[]> {
  const url = `${GEMINI_MODELS_URL}&key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Gemini models list failed (${res.status})`);
  }
  const data = (await res.json()) as {
    models?: Array<{
      name?: string;
      displayName?: string;
      supportedGenerationMethods?: string[];
      outputTokenLimit?: number;
    }>;
  };
  return (data.models ?? [])
    .filter((m) => {
      const methods = m.supportedGenerationMethods ?? [];
      if (!methods.includes("generateContent")) return false;
      if (typeof m.outputTokenLimit === "number" && m.outputTokenLimit <= 0) {
        return false;
      }
      const raw = m.name ?? "";
      const id = raw.replace(/^models\//, "");
      return isTextOutputLlm(id, "gemini");
    })
    .map((m) => {
      const raw = m.name ?? "";
      const id = raw.replace(/^models\//, "");
      return {
        id,
        label: m.displayName?.trim() || id
      };
    })
    .filter((m) => m.id);
}

function perTokenToPerMTok(raw: string | number | undefined): number | null {
  if (raw == null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  // OpenRouter quotes USD per token; others may already be per-million.
  if (n > 0 && n < 0.01) return n * 1_000_000;
  return n;
}

async function listOpenAiCompatibleModels(
  provider: AiProvider,
  apiKey: string
): Promise<{
  models: AiModelOption[];
  metaById: Map<string, { inputModalities?: string[]; outputModalities?: string[] }>;
}> {
  const base = providerInfo(provider).openaiBaseUrl;
  if (!base) throw new Error(`No models URL for ${provider}`);
  const res = await fetch(`${base.replace(/\/$/, "")}/models`, {
    headers: {
      Authorization: `Bearer ${apiKey}`
    }
  });
  if (!res.ok) {
    throw new Error(
      `${AI_PROVIDERS[provider].label} models list failed (${res.status})`
    );
  }
  const data = (await res.json()) as {
    data?: Array<{
      id?: string;
      object?: string;
      name?: string;
      architecture?: {
        input_modalities?: string[];
        output_modalities?: string[];
        modality?: string;
      };
      pricing?: {
        prompt?: string;
        completion?: string;
      };
    }>;
  };

  const metaById = new Map<
    string,
    { inputModalities?: string[]; outputModalities?: string[] }
  >();
  const models: AiModelOption[] = [];

  for (const m of data.data ?? []) {
    if (typeof m.id !== "string" || !m.id) continue;
    if (!isTextOutputLlm(m.id, provider)) continue;

    const arch = m.architecture;
    let inputModalities = arch?.input_modalities;
    let outputModalities = arch?.output_modalities;
    if (
      (!inputModalities || !outputModalities) &&
      typeof arch?.modality === "string"
    ) {
      // e.g. "text+image->text"
      const [inn, out] = arch.modality.split("->");
      if (inn) {
        inputModalities = inn.split("+").map((s) => s.trim());
      }
      if (out) {
        outputModalities = out.split("+").map((s) => s.trim());
      }
    }
    if (inputModalities || outputModalities) {
      metaById.set(m.id, { inputModalities, outputModalities });
    }

    let rates: TokenRates | undefined;
    const inR = perTokenToPerMTok(m.pricing?.prompt);
    const outR = perTokenToPerMTok(m.pricing?.completion);
    if (inR != null && outR != null) {
      rates = {
        inputPerMTokUsd: inR,
        outputPerMTokUsd: outR,
        source: "live"
      };
    }

    models.push({
      id: m.id,
      label: (m.name ?? m.id).trim() || m.id,
      rates
    });
  }

  return { models, metaById };
}

export async function listProviderModels(
  provider: AiProvider,
  apiKey: string,
  selected?: string | string[]
): Promise<{ models: AiModelOption[]; live: boolean; error?: string }> {
  const fallback = withHeuristicRates(
    provider,
    FALLBACK_MODELS[provider] ?? []
  );
  const selectedList = (Array.isArray(selected) ? selected : [selected])
    .map((s) => s?.trim())
    .filter((s): s is string => Boolean(s));

  const finalize = (models: AiModelOption[], metaById?: Map<string, { inputModalities?: string[]; outputModalities?: string[] }>) => {
    let vision = withHeuristicRates(
      provider,
      filterVisionModels(provider, models, metaById)
    );
    // Always keep currently selected ids so Settings doesn't blank out.
    for (const id of selectedList) {
      if (!modelFitsProvider(provider, id)) continue;
      if (vision.some((m) => m.id === id)) continue;
      const fromAll = models.find((m) => m.id === id);
      vision = mergeOptions(
        vision,
        [
          {
            id,
            label: fromAll?.label ?? id,
            rates:
              fromAll?.rates ??
              resolveRatesForProviderModel(provider, id) ??
              undefined
          }
        ],
        id
      );
    }
    // Prefer putting selected models first when they would otherwise be buried.
    return vision;
  };

  const withSelected = (models: AiModelOption[]) => {
    let next = models;
    for (const id of selectedList) {
      if (!modelFitsProvider(provider, id)) continue;
      next = mergeOptions(next, [], id);
    }
    return next;
  };

  if (!apiKey.trim()) {
    return {
      models: withSelected(finalize(fallback)),
      live: false,
      error: "Add an API key to load the live model list."
    };
  }
  try {
    const info = providerInfo(provider);
    if (info.auth === "gemini") {
      const live = await listGeminiModels(apiKey.trim());
      return {
        models: withSelected(finalize(mergeOptions(live, fallback))),
        live: true
      };
    }
    if (info.auth === "anthropic") {
      const live = await listClaudeModels(apiKey.trim());
      return {
        models: withSelected(finalize(mergeOptions(live, fallback))),
        live: true
      };
    }
    const { models: live, metaById } = await listOpenAiCompatibleModels(
      provider,
      apiKey.trim()
    );
    return {
      models: withSelected(finalize(mergeOptions(live, fallback), metaById)),
      live: true
    };
  } catch (err) {
    return {
      models: withSelected(finalize(fallback)),
      live: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}
