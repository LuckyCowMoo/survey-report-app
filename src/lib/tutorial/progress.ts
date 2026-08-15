const ONBOARDING_KEY = "survey-report-onboarding-complete";
const LANGUAGE_KEY = "survey-report-language";

export type TutorialLanguage = "en" | "cy" | "ga" | "gd";

export function isOnboardingComplete(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_KEY) === "1";
  } catch {
    return false;
  }
}

export function markOnboardingComplete(): void {
  try {
    localStorage.setItem(ONBOARDING_KEY, "1");
  } catch {
    /* private mode */
  }
}

export function loadTutorialLanguage(): TutorialLanguage | null {
  try {
    const v = localStorage.getItem(LANGUAGE_KEY);
    if (v === "en" || v === "cy" || v === "ga" || v === "gd") return v;
  } catch {
    /* ignore */
  }
  return null;
}

/** Stored for later — languages are not applied to the UI yet. */
export function saveTutorialLanguage(lang: TutorialLanguage): void {
  try {
    localStorage.setItem(LANGUAGE_KEY, lang);
  } catch {
    /* ignore */
  }
}
