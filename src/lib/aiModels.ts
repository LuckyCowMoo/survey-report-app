/** Live + fallback model lists for Settings dropdowns. */

import type { AiProvider } from "./aiProviders";
import { AI_PROVIDERS, modelFitsProvider, providerInfo } from "./aiProviders";

export interface AiModelOption {
  id: string;
  label: string;
}

const CLAUDE_MODELS_URL = "https://api.anthropic.com/v1/models?limit=100";
const GEMINI_MODELS_URL =
  "https://generativelanguage.googleapis.com/v1beta/models?pageSize=100";

/** Used when the live list cannot be fetched. */
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
    { id: "grok-3-mini", label: "Grok 3 Mini" },
    { id: "grok-3", label: "Grok 3" },
    { id: "grok-2-vision-1212", label: "Grok 2 Vision" }
  ],
  groq: [
    {
      id: "meta-llama/llama-4-scout-17b-16e-instruct",
      label: "Llama 4 Scout (Groq)"
    },
    {
      id: "meta-llama/llama-4-maverick-17b-128e-instruct",
      label: "Llama 4 Maverick (Groq)"
    },
    { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B" },
    { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B Instant" }
  ],
  openrouter: [
    { id: "openai/gpt-4.1-mini", label: "OpenAI GPT-4.1 mini" },
    { id: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4" },
    { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { id: "meta-llama/llama-4-scout", label: "Llama 4 Scout" }
  ],
  deepseek: [
    { id: "deepseek-chat", label: "DeepSeek Chat" },
    { id: "deepseek-reasoner", label: "DeepSeek Reasoner" }
  ],
  mistral: [
    { id: "mistral-small-latest", label: "Mistral Small" },
    { id: "mistral-medium-latest", label: "Mistral Medium" },
    { id: "pixtral-large-latest", label: "Pixtral Large" },
    { id: "mistral-large-latest", label: "Mistral Large" }
  ],
  together: [
    {
      id: "meta-llama/Llama-4-Scout-17B-16E-Instruct",
      label: "Llama 4 Scout"
    },
    {
      id: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      label: "Llama 3.3 70B Turbo"
    }
  ],
  fireworks: [
    {
      id: "accounts/fireworks/models/llama-v3p3-70b-instruct",
      label: "Llama 3.3 70B"
    },
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
  }
  if (selected?.trim() && !byId.has(selected.trim())) {
    byId.set(selected.trim(), { id: selected.trim(), label: selected.trim() });
  }
  return [...byId.values()];
}

/** Drop embeddings, image/video/audio specialists, etc. — keep text LLMs. */
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
    "realtime"
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
      n.includes("codestral")
    );
  }
  // Groq / OpenRouter / Together / Fireworks: keep most chat models.
  return true;
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

async function listOpenAiCompatibleModels(
  provider: AiProvider,
  apiKey: string
): Promise<AiModelOption[]> {
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
    data?: Array<{ id?: string; object?: string }>;
  };
  return (data.data ?? [])
    .filter((m) => typeof m.id === "string" && m.id)
    .filter((m) => isTextOutputLlm(m.id as string, provider))
    .map((m) => ({
      id: m.id as string,
      label: m.id as string
    }));
}

export async function listProviderModels(
  provider: AiProvider,
  apiKey: string,
  selected?: string | string[]
): Promise<{ models: AiModelOption[]; live: boolean; error?: string }> {
  const fallback = FALLBACK_MODELS[provider] ?? [];
  const selectedList = (Array.isArray(selected) ? selected : [selected])
    .map((s) => s?.trim())
    .filter((s): s is string => Boolean(s));

  const withSelected = (models: AiModelOption[]) => {
    let next = models;
    for (const id of selectedList) {
      // Never inject a Claude id into Gemini’s list (etc.).
      if (!modelFitsProvider(provider, id)) continue;
      next = mergeOptions(next, [], id);
    }
    return next;
  };

  if (!apiKey.trim()) {
    return {
      models: withSelected(mergeOptions([], fallback)),
      live: false,
      error: "Add an API key to load the live model list."
    };
  }
  try {
    const info = providerInfo(provider);
    const live =
      info.auth === "gemini"
        ? await listGeminiModels(apiKey.trim())
        : info.auth === "anthropic"
          ? await listClaudeModels(apiKey.trim())
          : await listOpenAiCompatibleModels(provider, apiKey.trim());
    return {
      models: withSelected(mergeOptions(live, fallback)),
      live: true
    };
  } catch (err) {
    return {
      models: withSelected(mergeOptions([], fallback)),
      live: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}
