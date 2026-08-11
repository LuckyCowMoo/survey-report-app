/** Live + fallback model lists for Settings dropdowns. */

import type { AiProvider } from "./settings";

export interface AiModelOption {
  id: string;
  label: string;
}

const CLAUDE_MODELS_URL = "https://api.anthropic.com/v1/models?limit=100";
const GEMINI_MODELS_URL =
  "https://generativelanguage.googleapis.com/v1beta/models?pageSize=100";

/** Used when the live list cannot be fetched. */
export const FALLBACK_CLAUDE_MODELS: AiModelOption[] = [
  { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
  { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
  { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" }
];

export const FALLBACK_GEMINI_MODELS: AiModelOption[] = [
  { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" }
];

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
    "robotics"
  ];
  if (blocked.some((b) => n.includes(b))) return false;

  if (provider === "claude") {
    // Messages API models are Claude chat/text models.
    return n.startsWith("claude");
  }

  // Gemini generative language models (not Imagen/Veo/embeddings).
  return n.startsWith("gemini");
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
    // Prefer models that advertise a text completion budget when present.
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
      // Must be able to generate text content (not embed-only / predict-only).
      if (!methods.includes("generateContent")) return false;
      // Exclude models with no text output budget when the API reports it.
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

export async function listProviderModels(
  provider: AiProvider,
  apiKey: string,
  selected?: string | string[]
): Promise<{ models: AiModelOption[]; live: boolean; error?: string }> {
  const fallback =
    provider === "gemini" ? FALLBACK_GEMINI_MODELS : FALLBACK_CLAUDE_MODELS;
  const selectedList = (Array.isArray(selected) ? selected : [selected])
    .map((s) => s?.trim())
    .filter((s): s is string => Boolean(s));

  const withSelected = (models: AiModelOption[]) => {
    let next = models;
    for (const id of selectedList) {
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
    const live =
      provider === "gemini"
        ? await listGeminiModels(apiKey.trim())
        : await listClaudeModels(apiKey.trim());
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
