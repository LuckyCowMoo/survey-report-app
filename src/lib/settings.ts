/** Persistent app settings, stored on the device in localStorage. */

import {
  type AiProvider,
  AI_PROVIDER_ORDER,
  AI_PROVIDERS,
  defaultsForProvider,
  detectProviderFromApiKey,
  modelFitsProvider,
  providerLabel
} from "./aiProviders";

export type { AiProvider } from "./aiProviders";
export { providerLabel };

export type ProviderApiKeys = Partial<Record<AiProvider, string>>;

export interface AppSettings {
  /** Which AI service is used for Ask AI / details suggestions. */
  provider: AiProvider;
  /** Per-provider API keys (stored on this device only). */
  apiKeys: ProviderApiKeys;
  /** Model for section Ask AI (for the active provider). */
  model: string;
  /** Model for details extras suggestions (for the active provider). */
  detailsSuggestModel: string;
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
  /**
   * When true, “Start new report” morphs into Import / Create.
   * When false, both actions are shown as stationary buttons.
   */
  homeCtaMorph: boolean;
  /**
   * Surveyor name shown as "Contact:" in the report page header.
   * Blank by default — required before generating a document.
   */
  surveyorName: string;
}

export const DEFAULT_MODEL = AI_PROVIDERS.claude.defaultModel;
export const DEFAULT_DETAILS_SUGGEST_MODEL =
  AI_PROVIDERS.claude.defaultDetailsModel;

/** Older defaults that Google has since retired for new API users. */
const RETIRED_GEMINI_MODELS = new Set([
  "gemini-2.5-flash",
  "gemini-3-flash-preview"
]);

/** Previous app defaults — migrate saved settings that still use these. */
const PREVIOUS_DEFAULT_DETAILS_SUGGEST_MODEL = "claude-opus-4-6";
const PREVIOUS_DEFAULT_GEMINI_DETAILS_SUGGEST_MODEL = "gemini-2.5-pro";

export function emptyApiKeys(): ProviderApiKeys {
  return {};
}

/** Stored key for a provider (active provider when omitted). */
export function providerApiKey(
  settings: AppSettings,
  provider?: AiProvider
): string {
  const id = provider ?? settings.provider;
  return (settings.apiKeys[id] ?? "").trim();
}

/** The API key/model pair for section AI. */
export function activeAi(settings: AppSettings): {
  provider: AiProvider;
  apiKey: string;
  model: string;
} {
  const fixed = ensureProviderModels(settings);
  return {
    provider: fixed.provider,
    apiKey: providerApiKey(fixed),
    model: fixed.model
  };
}

/** Model used for issues / recommendations / costs suggestions. */
export function activeDetailsSuggestAi(settings: AppSettings): {
  provider: AiProvider;
  apiKey: string;
  model: string;
} {
  const fixed = ensureProviderModels(settings);
  return {
    provider: fixed.provider,
    apiKey: providerApiKey(fixed),
    model:
      fixed.detailsSuggestModel ||
      defaultsForProvider(fixed.provider).detailsSuggestModel
  };
}

/** Save/replace the key for one provider without changing the active choice. */
export function setProviderApiKey(
  settings: AppSettings,
  provider: AiProvider,
  apiKey: string
): AppSettings {
  const nextKeys = { ...settings.apiKeys };
  const trimmed = apiKey.trim();
  if (trimmed) nextKeys[provider] = trimmed;
  else delete nextKeys[provider];
  return { ...settings, apiKeys: nextKeys };
}

/** Switch the active provider and reset models to that provider’s defaults. */
export function setActiveProvider(
  settings: AppSettings,
  provider: AiProvider
): AppSettings {
  if (provider === settings.provider) {
    return ensureProviderModels(settings);
  }
  const defaults = defaultsForProvider(provider);
  return {
    ...settings,
    provider,
    model: defaults.model,
    detailsSuggestModel: defaults.detailsSuggestModel
  };
}

/** Reset model ids that don’t belong to the active provider. */
export function ensureProviderModels(settings: AppSettings): AppSettings {
  const defaults = defaultsForProvider(settings.provider);
  const model = settings.model.trim();
  const details = settings.detailsSuggestModel.trim();
  const nextModel = modelFitsProvider(settings.provider, model)
    ? model
    : defaults.model;
  const nextDetails = modelFitsProvider(settings.provider, details)
    ? details
    : defaults.detailsSuggestModel;
  if (nextModel === settings.model && nextDetails === settings.detailsSuggestModel) {
    return settings;
  }
  return {
    ...settings,
    model: nextModel,
    detailsSuggestModel: nextDetails
  };
}

/**
 * Store a pasted API key.
 * - With `forcedProvider`: only updates that provider’s slot (guide screens).
 * - Without: stores under the detected provider (or active), and switches
 *   active provider when the key prefix is conclusive.
 */
export function applyApiKey(
  settings: AppSettings,
  apiKey: string,
  forcedProvider?: AiProvider
): AppSettings {
  const detected = detectProviderFromApiKey(apiKey);
  const target = forcedProvider ?? detected ?? settings.provider;
  let next = setProviderApiKey(settings, target, apiKey);

  if (forcedProvider) {
    // Guide / explicit slot edit — keep the user’s active provider choice.
    return next;
  }

  if (detected && detected !== next.provider) {
    next = setActiveProvider(next, detected);
  }
  return next;
}

const KEY = "survey-report-settings";

type LegacySettings = Partial<AppSettings> & {
  apiKey?: string;
  geminiApiKey?: string;
  geminiModel?: string;
  geminiDetailsSuggestModel?: string;
};

function isKnownProvider(value: unknown): value is AiProvider {
  return typeof value === "string" && value in AI_PROVIDERS;
}

function normalizeApiKeys(raw: unknown): ProviderApiKeys {
  if (!raw || typeof raw !== "object") return emptyApiKeys();
  const out: ProviderApiKeys = {};
  for (const id of AI_PROVIDER_ORDER) {
    const v = (raw as ProviderApiKeys)[id];
    if (typeof v === "string" && v.trim()) out[id] = v.trim();
  }
  return out;
}

export function loadSettings(): AppSettings {
  const defaults: AppSettings = {
    provider: "claude",
    apiKeys: emptyApiKeys(),
    model: DEFAULT_MODEL,
    detailsSuggestModel: DEFAULT_DETAILS_SUGGEST_MODEL,
    companyName: "DampMaster",
    website: "www.dampmaster.com",
    pipJumpOnHover: true,
    studioPhotoPassThrough: false,
    autoSuggestDetailsExtras: false,
    homeCtaMorph: true,
    surveyorName: ""
  };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as LegacySettings;

    const legacyGeminiKey = (parsed.geminiApiKey ?? "").trim();
    const legacySingleKey = (parsed.apiKey ?? "").trim();
    const apiKeys = normalizeApiKeys(parsed.apiKeys);

    // Migrate single-key / dual-key eras into apiKeys.
    if (Object.keys(apiKeys).length === 0) {
      if (legacyGeminiKey && legacySingleKey && legacyGeminiKey !== legacySingleKey) {
        apiKeys.claude = legacySingleKey;
        apiKeys.gemini = legacyGeminiKey;
      } else if (legacyGeminiKey && (parsed.provider === "gemini" || !legacySingleKey)) {
        apiKeys.gemini = legacyGeminiKey;
      } else if (legacySingleKey) {
        const detected = detectProviderFromApiKey(legacySingleKey);
        const slot =
          detected ??
          (isKnownProvider(parsed.provider) ? parsed.provider : "claude");
        apiKeys[slot] = legacySingleKey;
      }
    }

    let provider: AiProvider = defaults.provider;
    if (isKnownProvider(parsed.provider)) provider = parsed.provider;
    else {
      const first = AI_PROVIDER_ORDER.find((id) => apiKeys[id]);
      if (first) provider = first;
    }

    // Prefer an active provider that still has a key when possible.
    if (!apiKeys[provider]) {
      const withKey = AI_PROVIDER_ORDER.find((id) => apiKeys[id]);
      if (withKey) provider = withKey;
    }

    let model = (parsed.model ?? "").trim() || defaultsForProvider(provider).model;
    let detailsSuggestModel =
      (parsed.detailsSuggestModel ?? "").trim() ||
      defaultsForProvider(provider).detailsSuggestModel;

    if (parsed.provider === "gemini" || provider === "gemini") {
      if (RETIRED_GEMINI_MODELS.has(model) || !model) {
        model =
          (parsed.geminiModel ?? "").trim() || AI_PROVIDERS.gemini.defaultModel;
      }
      if (
        RETIRED_GEMINI_MODELS.has(detailsSuggestModel) ||
        !detailsSuggestModel ||
        detailsSuggestModel === PREVIOUS_DEFAULT_GEMINI_DETAILS_SUGGEST_MODEL
      ) {
        detailsSuggestModel =
          (parsed.geminiDetailsSuggestModel ?? "").trim() ||
          AI_PROVIDERS.gemini.defaultDetailsModel;
      }
    }

    if (RETIRED_GEMINI_MODELS.has(model)) {
      model = AI_PROVIDERS.gemini.defaultModel;
    }
    if (RETIRED_GEMINI_MODELS.has(detailsSuggestModel)) {
      detailsSuggestModel = AI_PROVIDERS.gemini.defaultDetailsModel;
    }
    if (
      detailsSuggestModel === PREVIOUS_DEFAULT_DETAILS_SUGGEST_MODEL ||
      detailsSuggestModel === PREVIOUS_DEFAULT_GEMINI_DETAILS_SUGGEST_MODEL
    ) {
      detailsSuggestModel = defaultsForProvider(provider).detailsSuggestModel;
    }

    // Drop models left over from a different provider (e.g. Claude id on Gemini).
    const providerDefaults = defaultsForProvider(provider);
    if (!modelFitsProvider(provider, model)) model = providerDefaults.model;
    if (!modelFitsProvider(provider, detailsSuggestModel)) {
      detailsSuggestModel = providerDefaults.detailsSuggestModel;
    }

    return {
      ...defaults,
      provider,
      apiKeys,
      model,
      detailsSuggestModel,
      companyName:
        typeof parsed.companyName === "string"
          ? parsed.companyName
          : defaults.companyName,
      website:
        typeof parsed.website === "string" ? parsed.website : defaults.website,
      pipJumpOnHover:
        typeof parsed.pipJumpOnHover === "boolean"
          ? parsed.pipJumpOnHover
          : defaults.pipJumpOnHover,
      studioPhotoPassThrough:
        typeof parsed.studioPhotoPassThrough === "boolean"
          ? parsed.studioPhotoPassThrough
          : defaults.studioPhotoPassThrough,
      autoSuggestDetailsExtras:
        typeof parsed.autoSuggestDetailsExtras === "boolean"
          ? parsed.autoSuggestDetailsExtras
          : defaults.autoSuggestDetailsExtras,
      homeCtaMorph:
        typeof parsed.homeCtaMorph === "boolean"
          ? parsed.homeCtaMorph
          : defaults.homeCtaMorph,
      surveyorName:
        typeof parsed.surveyorName === "string"
          ? parsed.surveyorName
          : defaults.surveyorName
    };
  } catch {
    return defaults;
  }
}

export function saveSettings(settings: AppSettings): void {
  const fixed = ensureProviderModels(settings);
  const clean: AppSettings = {
    provider: fixed.provider,
    apiKeys: normalizeApiKeys(fixed.apiKeys),
    model: fixed.model,
    detailsSuggestModel: fixed.detailsSuggestModel,
    companyName: fixed.companyName,
    website: fixed.website,
    pipJumpOnHover: fixed.pipJumpOnHover,
    studioPhotoPassThrough: fixed.studioPhotoPassThrough,
    autoSuggestDetailsExtras: fixed.autoSuggestDetailsExtras,
    homeCtaMorph: fixed.homeCtaMorph,
    surveyorName: fixed.surveyorName
  };
  localStorage.setItem(KEY, JSON.stringify(clean));
}
