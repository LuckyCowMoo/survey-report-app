/**
 * AI provider registry: key-prefix detection, defaults, and OpenAI-compatible
 * endpoint metadata for browser-side Ask AI.
 */

export type AiProvider =
  | "claude"
  | "gemini"
  | "openai"
  | "xai"
  | "groq"
  | "openrouter"
  | "deepseek"
  | "mistral"
  | "together"
  | "fireworks";

export type AiAuthStyle = "anthropic" | "gemini" | "bearer";

export interface AiProviderInfo {
  id: AiProvider;
  /** Short name for banners / settings. */
  label: string;
  /** One-line description for the supported-keys list. */
  keyHint: string;
  /** Example / recognisable key prefix shown in UI. */
  keyPrefix: string;
  /** How the HTTP client authenticates. */
  auth: AiAuthStyle;
  /**
   * OpenAI-compatible API root (…/v1) for bearer providers.
   * Unused for Claude / Gemini native clients.
   */
  openaiBaseUrl?: string;
  defaultModel: string;
  defaultDetailsModel: string;
  /** Docs / console URL for the guide. */
  docsUrl: string;
}

export const AI_PROVIDERS: Record<AiProvider, AiProviderInfo> = {
  claude: {
    id: "claude",
    label: "Claude (Anthropic)",
    keyHint: "Anthropic Claude",
    keyPrefix: "sk-ant-",
    auth: "anthropic",
    defaultModel: "claude-sonnet-5",
    defaultDetailsModel: "claude-sonnet-5",
    docsUrl: "https://platform.claude.com/settings/keys"
  },
  gemini: {
    id: "gemini",
    label: "Gemini (Google)",
    keyHint: "Google Gemini",
    keyPrefix: "AIza",
    auth: "gemini",
    defaultModel: "gemini-3.6-flash",
    defaultDetailsModel: "gemini-3.6-flash",
    docsUrl: "https://aistudio.google.com/app/apikey"
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    keyHint: "OpenAI (GPT)",
    keyPrefix: "sk- / sk-proj-",
    auth: "bearer",
    openaiBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4.1-mini",
    defaultDetailsModel: "gpt-4.1-mini",
    docsUrl: "https://platform.openai.com/api-keys"
  },
  xai: {
    id: "xai",
    label: "Grok (xAI)",
    keyHint: "xAI Grok",
    keyPrefix: "xai-",
    auth: "bearer",
    openaiBaseUrl: "https://api.x.ai/v1",
    defaultModel: "grok-2-vision-1212",
    defaultDetailsModel: "grok-2-vision-1212",
    docsUrl: "https://console.x.ai/"
  },
  groq: {
    id: "groq",
    label: "Groq (Llama & others)",
    keyHint: "Groq — Meta Llama and other open models",
    keyPrefix: "gsk_",
    auth: "bearer",
    openaiBaseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "meta-llama/llama-4-scout-17b-16e-instruct",
    defaultDetailsModel: "meta-llama/llama-4-scout-17b-16e-instruct",
    docsUrl: "https://console.groq.com/keys"
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    keyHint: "OpenRouter (many models via one key)",
    keyPrefix: "sk-or-",
    auth: "bearer",
    openaiBaseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-4.1-mini",
    defaultDetailsModel: "openai/gpt-4.1-mini",
    docsUrl: "https://openrouter.ai/keys"
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    keyHint: "DeepSeek (OpenAI-style sk-… keys)",
    keyPrefix: "sk-…",
    auth: "bearer",
    openaiBaseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    defaultDetailsModel: "deepseek-chat",
    docsUrl: "https://platform.deepseek.com/api_keys"
  },
  mistral: {
    id: "mistral",
    label: "Mistral",
    keyHint: "Mistral (no fixed prefix — tap to select)",
    keyPrefix: "(no fixed prefix)",
    auth: "bearer",
    openaiBaseUrl: "https://api.mistral.ai/v1",
    defaultModel: "mistral-small-latest",
    defaultDetailsModel: "mistral-small-latest",
    docsUrl: "https://console.mistral.ai/api-keys"
  },
  together: {
    id: "together",
    label: "Together AI",
    keyHint: "Together AI (Llama and open models)",
    keyPrefix: "(no fixed prefix)",
    auth: "bearer",
    openaiBaseUrl: "https://api.together.xyz/v1",
    defaultModel: "meta-llama/Llama-4-Scout-17B-16E-Instruct",
    defaultDetailsModel: "meta-llama/Llama-4-Scout-17B-16E-Instruct",
    docsUrl: "https://api.together.ai/settings/api-keys"
  },
  fireworks: {
    id: "fireworks",
    label: "Fireworks",
    keyHint: "Fireworks AI",
    keyPrefix: "fw_",
    auth: "bearer",
    openaiBaseUrl: "https://api.fireworks.ai/inference/v1",
    defaultModel: "accounts/fireworks/models/llama4-scout-instruct-basic",
    defaultDetailsModel:
      "accounts/fireworks/models/llama4-scout-instruct-basic",
    docsUrl: "https://fireworks.ai/account/api-keys"
  }
};

/** Stable order for Settings + Guide lists. */
export const AI_PROVIDER_ORDER: AiProvider[] = [
  "claude",
  "gemini",
  "openai",
  "xai",
  "groq",
  "openrouter",
  "deepseek",
  "mistral",
  "together",
  "fireworks"
];

export function providerLabel(provider: AiProvider): string {
  return AI_PROVIDERS[provider]?.label ?? provider;
}

export function providerInfo(provider: AiProvider): AiProviderInfo {
  return AI_PROVIDERS[provider];
}

/**
 * Infer the provider from a pasted API key.
 * Ambiguous OpenAI-style `sk-…` keys default to OpenAI; tap DeepSeek in the
 * supported list if that is what you pasted.
 */
export function detectProviderFromApiKey(raw: string): AiProvider | null {
  const key = raw.trim();
  if (!key) return null;

  if (key.startsWith("sk-ant-")) return "claude";
  if (key.startsWith("AIza")) return "gemini";
  if (key.startsWith("xai-")) return "xai";
  if (key.startsWith("gsk_")) return "groq";
  if (key.startsWith("sk-or-")) return "openrouter";
  if (key.startsWith("fw_")) return "fireworks";
  if (
    key.startsWith("sk-proj-") ||
    key.startsWith("sk-svcacct-") ||
    key.startsWith("sk-")
  ) {
    return "openai";
  }

  // Opaque keys (Mistral, Together, some Gemini variants) — leave unset
  // until the user taps a provider in the supported list.
  return null;
}

/** True when this key strongly identifies `provider` (not a manual pick). */
export function keyMatchesProvider(raw: string, provider: AiProvider): boolean {
  const detected = detectProviderFromApiKey(raw);
  if (detected === provider) return true;
  // Manual picks for prefix-less / ambiguous providers.
  if (
    provider === "mistral" ||
    provider === "together" ||
    provider === "deepseek"
  ) {
    return Boolean(raw.trim()) && detected !== "claude" && detected !== "gemini";
  }
  return false;
}

export function defaultsForProvider(provider: AiProvider): {
  model: string;
  detailsSuggestModel: string;
} {
  const info = AI_PROVIDERS[provider];
  return {
    model: info.defaultModel,
    detailsSuggestModel: info.defaultDetailsModel
  };
}

/**
 * True when a model id is plausible for this provider (avoids calling Gemini
 * with claude-… etc. after a provider switch).
 */
export function modelFitsProvider(
  provider: AiProvider,
  modelId: string
): boolean {
  const id = modelId.trim().toLowerCase().replace(/^models\//, "");
  if (!id) return false;
  switch (provider) {
    case "claude":
      return id.startsWith("claude");
    case "gemini":
      return id.startsWith("gemini");
    case "openai":
      return (
        id.startsWith("gpt-") ||
        id.startsWith("o1") ||
        id.startsWith("o3") ||
        id.startsWith("o4") ||
        id.startsWith("chatgpt")
      );
    case "xai":
      return id.startsWith("grok");
    case "groq":
      return (
        id.includes("llama") ||
        id.includes("groq") ||
        id.includes("mixtral") ||
        id.includes("gemma") ||
        id.includes("qwen") ||
        id.includes("gpt-oss")
      );
    case "openrouter":
      // OpenRouter ids are usually provider/model.
      return id.includes("/") || id.startsWith("openrouter");
    case "deepseek":
      return id.includes("deepseek");
    case "mistral":
      return (
        id.includes("mistral") ||
        id.includes("mixtral") ||
        id.includes("codestral") ||
        id.includes("ministral") ||
        id.includes("pixtral")
      );
    case "together":
      return id.includes("/") || id.toLowerCase().includes("llama");
    case "fireworks":
      return id.includes("accounts/") || id.includes("fireworks");
    default:
      return true;
  }
}
