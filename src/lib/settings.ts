/** Persistent app settings, stored on the device in localStorage. */

export interface AppSettings {
  apiKey: string;
  model: string;
  companyName: string;
  website: string;
  surveyorName: string;
}

export const DEFAULT_MODEL = "claude-sonnet-5";

const KEY = "survey-report-settings";

export function loadSettings(): AppSettings {
  const defaults: AppSettings = {
    apiKey: "",
    model: DEFAULT_MODEL,
    companyName: "DampMaster",
    website: "www.dampmaster.com",
    surveyorName: ""
  };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults;
    return { ...defaults, ...(JSON.parse(raw) as Partial<AppSettings>) };
  } catch {
    return defaults;
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(KEY, JSON.stringify(settings));
}
