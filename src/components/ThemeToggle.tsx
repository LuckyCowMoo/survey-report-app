import { useState } from "react";
import { applyTheme, loadTheme, type Theme } from "../lib/theme";

const themes: { value: Theme; label: string; swatch: string }[] = [
  { value: "expressive", label: "Studio", swatch: "Coral" },
  { value: "dark", label: "Dark", swatch: "Ink" },
  { value: "original", label: "Original", swatch: "Blue" }
];

export default function ThemePicker() {
  const [theme, setTheme] = useState<Theme>(loadTheme);

  const selectTheme = (next: Theme) => {
    setTheme(next);
    applyTheme(next);
  };

  return (
    <div className="theme-field">
      <span className="theme-field-label">Appearance</span>
      <div className="theme-options" role="radiogroup" aria-label="Appearance">
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
            <strong>{option.label}</strong>
            <small>{option.swatch}</small>
          </button>
        ))}
      </div>
    </div>
  );
}
