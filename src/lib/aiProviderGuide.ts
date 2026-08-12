/**
 * Guide-only provider branding + setup copy for the AI key slider.
 */

import type { AiProvider } from "./aiProviders";
import { AI_PROVIDER_ORDER, AI_PROVIDERS } from "./aiProviders";

export interface ProviderBrand {
  /** Accent used for the hero panel / slider thumb when selected. */
  accent: string;
  /** Soft panel background. */
  panel: string;
  /** Primary text on the branded panel. */
  ink: string;
  /** Muted text on the branded panel. */
  muted: string;
  /** Short display name under the logo (product, e.g. ChatGPT). */
  shortName: string;
  /** Small top line — lab / company (e.g. OpenAI, Meta). */
  company: string;
  /** Name used in “get / paste … key” copy when the API host differs. */
  keyService: string;
}

export interface ProviderSetupStep {
  text: string;
  href?: string;
  linkLabel?: string;
  afterLink?: string;
}

export interface ProviderGuideEntry {
  id: AiProvider;
  brand: ProviderBrand;
  keyPrefix: string;
  docsUrl: string;
  steps: ProviderSetupStep[];
  note?: string;
}

export const PROVIDER_BRANDS: Record<AiProvider, ProviderBrand> = {
  claude: {
    accent: "#c15f3c",
    panel: "#2a211c",
    ink: "#f6efe9",
    muted: "rgba(246, 239, 233, 0.72)",
    company: "Anthropic",
    shortName: "Claude",
    keyService: "Anthropic"
  },
  gemini: {
    accent: "#4285f4",
    panel: "#1a2333",
    ink: "#eef3ff",
    muted: "rgba(238, 243, 255, 0.72)",
    company: "Google",
    shortName: "Gemini",
    keyService: "Google"
  },
  openai: {
    accent: "#10a37f",
    panel: "#10241d",
    ink: "#e8fff6",
    muted: "rgba(232, 255, 246, 0.72)",
    company: "OpenAI",
    shortName: "ChatGPT",
    keyService: "OpenAI"
  },
  xai: {
    accent: "#e8e8e8",
    panel: "#111111",
    ink: "#f5f5f5",
    muted: "rgba(245, 245, 245, 0.7)",
    company: "xAI",
    shortName: "Grok",
    keyService: "xAI"
  },
  groq: {
    accent: "#0668e1",
    panel: "#0f1a2e",
    ink: "#eaf2ff",
    muted: "rgba(234, 242, 255, 0.72)",
    company: "Meta",
    shortName: "Llama",
    keyService: "Groq"
  },
  openrouter: {
    accent: "#6566f1",
    panel: "#1a1b33",
    ink: "#eef0ff",
    muted: "rgba(238, 240, 255, 0.72)",
    company: "OpenRouter",
    shortName: "Many models",
    keyService: "OpenRouter"
  },
  deepseek: {
    accent: "#4d6bfe",
    panel: "#121a33",
    ink: "#eef2ff",
    muted: "rgba(238, 242, 255, 0.72)",
    company: "DeepSeek",
    shortName: "DeepSeek",
    keyService: "DeepSeek"
  },
  mistral: {
    accent: "#ff7000",
    panel: "#2a180c",
    ink: "#fff4eb",
    muted: "rgba(255, 244, 235, 0.72)",
    company: "Mistral",
    shortName: "Mistral",
    keyService: "Mistral"
  },
  together: {
    accent: "#0f6fff",
    panel: "#0f1a2e",
    ink: "#eaf2ff",
    muted: "rgba(234, 242, 255, 0.72)",
    company: "Together AI",
    shortName: "Open models",
    keyService: "Together"
  },
  fireworks: {
    accent: "#7c3aed",
    panel: "#1a1230",
    ink: "#f3ecff",
    muted: "rgba(243, 236, 255, 0.72)",
    company: "Fireworks",
    shortName: "Open models",
    keyService: "Fireworks"
  }
};

function linkStep(
  before: string,
  href: string,
  linkLabel: string,
  after = "."
): ProviderSetupStep {
  return { text: before, href, linkLabel, afterLink: after };
}

export const PROVIDER_GUIDE: Record<AiProvider, ProviderGuideEntry> =
  Object.fromEntries(
    AI_PROVIDER_ORDER.map((id) => {
      const info = AI_PROVIDERS[id];
      const brand = PROVIDER_BRANDS[id];
      return [id, buildGuide(id, info.keyPrefix, info.docsUrl, brand)];
    })
  ) as Record<AiProvider, ProviderGuideEntry>;

function buildGuide(
  id: AiProvider,
  keyPrefix: string,
  docsUrl: string,
  brand: ProviderBrand
): ProviderGuideEntry {
  const commonPaste = `Paste the key into Settings → AI API key. ${
    keyPrefix.includes("no fixed")
      ? `Then tap ${brand.keyService} under Active AI service → Add other if it isn’t selected.`
      : `Keys like ${keyPrefix} are detected automatically.`
  }`;

  const byId: Record<AiProvider, Omit<ProviderGuideEntry, "id" | "brand" | "keyPrefix" | "docsUrl">> = {
    claude: {
      steps: [
        linkStep("Sign in (or create an account) at ", "https://platform.claude.com/", "platform.claude.com"),
        linkStep("Open ", docsUrl, "Settings → API keys"),
        {
          text: "Click Create key, give it a name, and copy it immediately (it starts with sk-ant- and is only shown once)."
        },
        {
          text: "In Anthropic’s console, add billing / credits under Plans & Billing — new keys usually will not work until payment is set up."
        },
        { text: commonPaste }
      ]
    },
    gemini: {
      steps: [
        linkStep("Sign in with a Google account at ", docsUrl, "aistudio.google.com/app/apikey"),
        {
          text: "Click Create API key and choose (or create) a Google Cloud project when asked."
        },
        {
          text: "Copy the key (often starts with AIza) and store it somewhere safe."
        },
        { text: commonPaste },
        {
          text: "Gemini has a limited free tier for testing — check Google AI Studio for current limits and billing."
        }
      ]
    },
    openai: {
      steps: [
        linkStep("Sign in at ", "https://platform.openai.com/", "platform.openai.com"),
        linkStep("Open ", docsUrl, "API keys"),
        {
          text: "Create a new secret key (often sk-proj-… or sk-…). Copy it immediately."
        },
        {
          text: "Add billing credits if prompted — many new accounts need a payment method before the key works."
        },
        { text: commonPaste }
      ]
    },
    xai: {
      steps: [
        linkStep("Sign in at ", "https://console.x.ai/", "console.x.ai"),
        {
          text: "Create an API key (starts with xai-) and copy it."
        },
        {
          text: "Ensure the account has API access / credits enabled for Grok models."
        },
        { text: commonPaste }
      ]
    },
    groq: {
      steps: [
        linkStep("Sign in at ", "https://console.groq.com/", "console.groq.com"),
        linkStep("Open ", docsUrl, "API Keys"),
        {
          text: "Create a key (starts with gsk_) and copy it."
        },
        {
          text: "Pick a Llama (or other) chat model in Settings after pasting — Groq is a fast host for Meta Llama and similar open models."
        },
        { text: commonPaste }
      ]
    },
    openrouter: {
      steps: [
        linkStep("Sign in at ", "https://openrouter.ai/", "openrouter.ai"),
        linkStep("Open ", docsUrl, "Keys"),
        {
          text: "Create a key (starts with sk-or-) and copy it."
        },
        {
          text: "Add credits if needed. OpenRouter can route to many labs through one key."
        },
        { text: commonPaste }
      ]
    },
    deepseek: {
      steps: [
        linkStep("Sign in at ", "https://platform.deepseek.com/", "platform.deepseek.com"),
        linkStep("Open ", docsUrl, "API keys"),
        {
          text: "Create a key (OpenAI-style sk-…) and copy it."
        },
        {
          text: "Paste into Settings. If detection picks OpenAI, tap DeepSeek under Supported API key types."
        }
      ]
    },
    mistral: {
      steps: [
        linkStep("Sign in at ", "https://console.mistral.ai/", "console.mistral.ai"),
        linkStep("Open ", docsUrl, "API keys"),
        {
          text: "Create a key (no fixed prefix) and copy it."
        },
        {
          text: "Paste into Settings, then tap Mistral under Supported API key types so the app sends requests to Mistral."
        }
      ]
    },
    together: {
      steps: [
        linkStep("Sign in at ", "https://api.together.ai/", "api.together.ai"),
        linkStep("Open ", docsUrl, "API keys"),
        {
          text: "Create a key and copy it."
        },
        {
          text: "Paste into Settings, then tap Together under Supported API key types. Together hosts Meta Llama and other open models."
        }
      ]
    },
    fireworks: {
      steps: [
        linkStep("Sign in at ", "https://fireworks.ai/", "fireworks.ai"),
        linkStep("Open ", docsUrl, "API keys"),
        {
          text: "Create a key (starts with fw_) and copy it."
        },
        { text: commonPaste }
      ]
    }
  };

  return {
    id,
    brand,
    keyPrefix,
    docsUrl,
    ...byId[id]
  };
}

/** Slider notch 0 = intro (app theme); 1…N = providers in AI_PROVIDER_ORDER. */
export const GUIDE_SLIDER_PROVIDERS = AI_PROVIDER_ORDER;

export function guideProviderAtNotch(notch: number): AiProvider | null {
  if (notch <= 0) return null;
  return GUIDE_SLIDER_PROVIDERS[notch - 1] ?? null;
}

export function guideNotchCount(): number {
  return GUIDE_SLIDER_PROVIDERS.length + 1;
}
