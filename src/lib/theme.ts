export type Theme = "expressive" | "dark";

const THEME_KEY = "survey-report-theme";
/** Keep in sync with `--theme-transition-ms` in styles.css */
export const THEME_TRANSITION_MS = 5000;

let themeTransitionTimer = 0;

export function loadTheme(): Theme {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "expressive" || saved === "dark") return saved;
  if (saved === "original") return "expressive";
  return "dark";
}

export function applyTheme(
  theme: Theme,
  options?: { animate?: boolean }
): void {
  const root = document.documentElement;
  const previous = root.dataset.theme as Theme | "original" | undefined;
  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;
  const shouldAnimate =
    options?.animate === true ||
    (options?.animate !== false &&
      previous != null &&
      previous !== theme &&
      !reduceMotion);

  if (shouldAnimate) {
    root.classList.add("theme-animating");
    window.clearTimeout(themeTransitionTimer);
    themeTransitionTimer = window.setTimeout(() => {
      root.classList.remove("theme-animating");
      themeTransitionTimer = 0;
    }, THEME_TRANSITION_MS);
  } else {
    root.classList.remove("theme-animating");
    window.clearTimeout(themeTransitionTimer);
    themeTransitionTimer = 0;
  }

  root.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
}
