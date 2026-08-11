/** Persistent app settings, stored on the device in localStorage. */

export type AiProvider = "claude" | "gemini";

export interface AppSettings {
  /** Which AI service resolves flagged sections. */
  provider: AiProvider;
  /** Claude (Anthropic) credentials. */
  apiKey: string;
  /** Claude model for section Ask AI. */
  model: string;
  /** Claude model for details extras suggestions. */
  detailsSuggestModel: string;
  /** Gemini (Google) credentials. */
  geminiApiKey: string;
  /** Gemini model for section Ask AI. */
  geminiModel: string;
  /** Gemini model for details extras suggestions. */
  geminiDetailsSuggestModel: string;
  companyName: string;
  website: string;
  /**
   * When true, hovering a review status pip jumps to that section.
   * When false, a click/tap is required.
   */
  pipJumpOnHover: boolean;
  /**
   * When true, the studio photo scrolls through every in-between section
   * image when jumping across multiple sections on Review.
   */
  studioPhotoPassThrough: boolean;
  /**
   * When true, details extras suggestions run automatically ~5s after
   * opening Report details (once per visit).
   */
  autoSuggestDetailsExtras: boolean;
}

export const DEFAULT_MODEL = "claude-sonnet-5";
export const DEFAULT_DETAILS_SUGGEST_MODEL = "claude-opus-4-6";
export const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";
export const DEFAULT_GEMINI_DETAILS_SUGGEST_MODEL = "gemini-2.5-pro";

/** Older defaults that Google has since retired for new API users. */
const RETIRED_GEMINI_MODELS = new Set(["gemini-2.5-flash", "gemini-3-flash-preview"]);

/** The API key/model pair for the currently selected provider (section AI). */
export function activeAi(settings: AppSettings): {
  provider: AiProvider;
  apiKey: string;
  model: string;
} {
  return settings.provider === "gemini"
    ? { provider: "gemini", apiKey: settings.geminiApiKey, model: settings.geminiModel }
    : { provider: "claude", apiKey: settings.apiKey, model: settings.model };
}

/** Model used for issues / recommendations / costs suggestions. */
export function activeDetailsSuggestAi(settings: AppSettings): {
  provider: AiProvider;
  apiKey: string;
  model: string;
} {
  return settings.provider === "gemini"
    ? {
        provider: "gemini",
        apiKey: settings.geminiApiKey,
        model: settings.geminiDetailsSuggestModel || DEFAULT_GEMINI_DETAILS_SUGGEST_MODEL
      }
    : {
        provider: "claude",
        apiKey: settings.apiKey,
        model: settings.detailsSuggestModel || DEFAULT_DETAILS_SUGGEST_MODEL
      };
}

const KEY = "survey-report-settings";

export function loadSettings(): AppSettings {
  const defaults: AppSettings = {
    provider: "claude",
    apiKey: "",
    model: DEFAULT_MODEL,
    detailsSuggestModel: DEFAULT_DETAILS_SUGGEST_MODEL,
    geminiApiKey: "",
    geminiModel: DEFAULT_GEMINI_MODEL,
    geminiDetailsSuggestModel: DEFAULT_GEMINI_DETAILS_SUGGEST_MODEL,
    companyName: "DampMaster",
    website: "www.dampmaster.com",
    pipJumpOnHover: true,
    studioPhotoPassThrough: false,
    autoSuggestDetailsExtras: false
  };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults;
    const merged = { ...defaults, ...(JSON.parse(raw) as Partial<AppSettings>) };
    // Migrate saved settings that still point at a retired model.
    if (RETIRED_GEMINI_MODELS.has(merged.geminiModel)) {
      merged.geminiModel = DEFAULT_GEMINI_MODEL;
    }
    if (RETIRED_GEMINI_MODELS.has(merged.geminiDetailsSuggestModel)) {
      merged.geminiDetailsSuggestModel = DEFAULT_GEMINI_DETAILS_SUGGEST_MODEL;
    }
    if (!merged.detailsSuggestModel) {
      merged.detailsSuggestModel = DEFAULT_DETAILS_SUGGEST_MODEL;
    }
    if (!merged.geminiDetailsSuggestModel) {
      merged.geminiDetailsSuggestModel = DEFAULT_GEMINI_DETAILS_SUGGEST_MODEL;
    }
    return merged;
  } catch {
    return defaults;
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(KEY, JSON.stringify(settings));
}
