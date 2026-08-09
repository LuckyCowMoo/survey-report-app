/** Persistent app settings, stored on the device in localStorage. */

export type AiProvider = "claude" | "gemini";

export interface AppSettings {
  /** Which AI service resolves flagged sections. */
  provider: AiProvider;
  /** Claude (Anthropic) credentials. */
  apiKey: string;
  model: string;
  /** Gemini (Google) credentials. */
  geminiApiKey: string;
  geminiModel: string;
  companyName: string;
  website: string;
}

export const DEFAULT_MODEL = "claude-sonnet-5";
export const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";

/** Older defaults that Google has since retired for new API users. */
const RETIRED_GEMINI_MODELS = new Set(["gemini-2.5-flash", "gemini-3-flash-preview"]);

/** The API key/model pair for the currently selected provider. */
export function activeAi(settings: AppSettings): {
  provider: AiProvider;
  apiKey: string;
  model: string;
} {
  return settings.provider === "gemini"
    ? { provider: "gemini", apiKey: settings.geminiApiKey, model: settings.geminiModel }
    : { provider: "claude", apiKey: settings.apiKey, model: settings.model };
}

const KEY = "survey-report-settings";

export function loadSettings(): AppSettings {
  const defaults: AppSettings = {
    provider: "claude",
    apiKey: "",
    model: DEFAULT_MODEL,
    geminiApiKey: "",
    geminiModel: DEFAULT_GEMINI_MODEL,
    companyName: "DampMaster",
    website: "www.dampmaster.com"
  };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults;
    const merged = { ...defaults, ...(JSON.parse(raw) as Partial<AppSettings>) };
    // Migrate saved settings that still point at a retired model.
    if (RETIRED_GEMINI_MODELS.has(merged.geminiModel)) {
      merged.geminiModel = DEFAULT_GEMINI_MODEL;
    }
    return merged;
  } catch {
    return defaults;
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(KEY, JSON.stringify(settings));
}
