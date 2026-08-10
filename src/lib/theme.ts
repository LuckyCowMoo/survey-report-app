export type Theme = "expressive" | "dark" | "original";

const THEME_KEY = "survey-report-theme";

export function loadTheme(): Theme {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "expressive" || saved === "dark" || saved === "original") return saved;
  return "dark";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
}
