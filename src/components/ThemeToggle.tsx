import { useState } from "react";
import { applyTheme, loadTheme, type Theme } from "../lib/theme";
import { useT } from "../lib/i18n";

interface Props {
  /** Fired after a new theme is applied (e.g. close Settings to show the fade). */
  onThemeApplied?: () => void;
}

export default function ThemePicker({ onThemeApplied }: Props) {
  const t = useT();
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const themes: { value: Theme; label: string; swatch: string }[] = [
    {
      value: "expressive",
      label: t("settings.themeStudio"),
      swatch: t("settings.themeStudioSwatch")
    },
    {
      value: "dark",
      label: t("settings.themeDark"),
      swatch: t("settings.themeDarkSwatch")
    }
  ];

  const selectTheme = (next: Theme) => {
    if (next === theme) return;
    setTheme(next);
    applyTheme(next);
    onThemeApplied?.();
  };

  return (
    <div className="theme-field">
      <span className="theme-field-label">{t("settings.appearance")}</span>
      <div className="theme-options" role="radiogroup" aria-label={t("settings.appearance")}>
        {themes.map((option) => (
          <button
            key={option.value}
            className={`theme-option${theme === option.value ? " active" : ""}`}
            type="button"
            role="radio"
            aria-checked={theme === option.value}
            onClick={() => selectTheme(option.value)}
          >
            <span className={`theme-swatch ${option.value}`} aria-hidden>
              <i />
            </span>
            <strong data-fit-text>{option.label}</strong>
            <small>{option.swatch}</small>
          </button>
        ))}
      </div>
    </div>
  );
}
