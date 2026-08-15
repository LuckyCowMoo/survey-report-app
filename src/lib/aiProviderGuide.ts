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
  whyChoose: string;
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
  } The key stays on this device and is sent only to that provider when you press Ask AI.`;

  const why: Record<AiProvider, string> = {
    claude:
      "Choose Claude if you want careful, formal British-English drafting that stays close to a surveyor’s notes and is less likely to invent meter readings.",
    gemini:
      "Choose Gemini if you want a Google account, a usable free tier for trying Ask AI, and generally fast replies while you are still evaluating the feature.",
    openai:
      "Choose OpenAI if you already buy ChatGPT API credit and want a widely supported, high-quality writer for polishing field notes into client paragraphs.",
    xai:
      "Choose xAI if you specifically want Grok models; it is a paid console key and is useful when your firm already standardised on that lab.",
    groq:
      "Choose Groq if you care most about speed: it hosts Llama and similar open models with very high tokens-per-second, which feels snappy on site.",
    openrouter:
      "Choose OpenRouter if you want one key that can reach many labs, including free-tier models, without signing up to each provider separately.",
    deepseek:
      "Choose DeepSeek if you want capable open-weight models at a low cost, and you are happy to confirm the key type in Settings when detection is ambiguous.",
    mistral:
      "Choose Mistral if you prefer European hosting and Magma/Mistral chat models, with an explicit provider pick in Settings because keys have no fixed prefix.",
    together:
      "Choose Together AI if you want a wide catalogue of open models (Llama and others) from one OpenAI-compatible endpoint.",
    fireworks:
      "Choose Fireworks if you want fast hosted open models and already use their console; keys are easy to recognise (fw_) in Settings."
  };

  const byId: Record<AiProvider, Omit<ProviderGuideEntry, "id" | "brand" | "keyPrefix" | "docsUrl" | "whyChoose">> = {
    claude: {
      steps: [
        linkStep("Sign in (or create an account) at ", "https://platform.claude.com/", "platform.claude.com"),
        linkStep("Open ", docsUrl, "Settings → API keys"),
        {
          text: "Click Create key, give it a name that you will recognise later (for example “Report studio phone”), and copy it immediately. Anthropic shows the secret only once, and it starts with sk-ant-."
        },
        {
          text: "In Anthropic’s console, add billing or credits under Plans & Billing. A brand-new key usually will not run until payment is set up, even if the key looks valid."
        },
        { text: commonPaste }
      ]
    },
    gemini: {
      steps: [
        linkStep("Sign in with a Google account at ", docsUrl, "aistudio.google.com/app/apikey"),
        {
          text: "Click Create API key and choose (or create) a Google Cloud project when asked. The project is what Google bills against if you leave the free allowance."
        },
        {
          text: "Copy the key (often starts with AIza) and store it somewhere safe. Anyone with the key can spend your quota."
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
          text: "Create a new secret key (often sk-proj-… or sk-…). Copy it immediately — OpenAI will not show the full key again."
        },
        {
          text: "Add billing credits if prompted. Many new platform accounts need a payment method before any model call succeeds."
        },
        { text: commonPaste }
      ]
    },
    xai: {
      steps: [
        linkStep("Sign in at ", "https://console.x.ai/", "console.x.ai"),
        {
          text: "Open API keys, create a key (it starts with xai-), and copy it immediately."
        },
        {
          text: "Check that the team has Grok API access and prepaid credit. A key alone is not enough if the console still shows billing as incomplete."
        },
        { text: commonPaste }
      ]
    },
    groq: {
      steps: [
        linkStep("Sign in at ", "https://console.groq.com/", "console.groq.com"),
        linkStep("Open ", docsUrl, "API Keys"),
        {
          text: "Create a key (starts with gsk_) and copy it. Store it on the device only — Groq will not show the full secret again."
        },
        {
          text: "After pasting in Settings, pick a Llama (or other) chat model. Groq is a fast host rather than the author of the model, which is why replies feel almost instant on a survey."
        },
        { text: commonPaste }
      ]
    },
    openrouter: {
      steps: [
        linkStep("Sign in at ", "https://openrouter.ai/", "openrouter.ai"),
        linkStep("Open ", docsUrl, "Keys"),
        {
          text: "Create a key (starts with sk-or-) and copy it. You can restrict the key in OpenRouter if you only want certain models."
        },
        {
          text: "OpenRouter can route to many labs through one key. Free models have daily limits; paid credit on the same account unlocks faster and stronger models when you need them."
        },
        { text: commonPaste }
      ]
    },
    deepseek: {
      steps: [
        linkStep("Sign in at ", "https://platform.deepseek.com/", "platform.deepseek.com"),
        linkStep("Open ", docsUrl, "API keys"),
        {
          text: "Create a key. DeepSeek uses an OpenAI-style sk-… prefix, so this app may first guess OpenAI."
        },
        {
          text: "Paste into Settings. If the Active AI service shows OpenAI, tap DeepSeek under Supported API key types so requests go to DeepSeek’s endpoint."
        },
        { text: commonPaste }
      ]
    },
    mistral: {
      steps: [
        linkStep("Sign in at ", "https://console.mistral.ai/", "console.mistral.ai"),
        linkStep("Open ", docsUrl, "API keys"),
        {
          text: "Create a key and copy it. Mistral keys have no fixed prefix, so the app cannot detect the provider from the string alone."
        },
        {
          text: "Paste into Settings, then tap Mistral under Supported API key types so the app sends chat requests to Mistral rather than another OpenAI-compatible host."
        }
      ]
    },
    together: {
      steps: [
        linkStep("Sign in at ", "https://api.together.ai/", "api.together.ai"),
        linkStep("Open ", docsUrl, "API keys"),
        {
          text: "Create a key and copy it. Together does not use a unique prefix, so you must choose the provider in Settings after pasting."
        },
        {
          text: "Paste into Settings, then tap Together under Supported API key types. Together hosts Meta Llama and other open models from one OpenAI-compatible endpoint."
        }
      ]
    },
    fireworks: {
      steps: [
        linkStep("Sign in at ", "https://fireworks.ai/", "fireworks.ai"),
        linkStep("Open ", docsUrl, "API keys"),
        {
          text: "Create a key (starts with fw_) and copy it. The prefix is detected automatically in Settings."
        },
        {
          text: "Fireworks is aimed at hosted open models with low latency. After pasting, pick the chat model you want for Ask AI."
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
    whyChoose: why[id],
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
