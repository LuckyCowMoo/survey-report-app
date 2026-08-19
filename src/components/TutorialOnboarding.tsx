import { useEffect, useState } from "react";
import { applyTheme, loadTheme, type Theme } from "../lib/theme";
import { useTextReveal } from "../lib/textReveal";
import { setUiLanguage, useT } from "../lib/i18n";
import {
  loadTutorialLanguage,
  type TutorialLanguage
} from "../lib/tutorial/progress";
import { loadSettings } from "../lib/settings";
import type { TutorialBeat } from "../lib/tutorial/flow";
import CountryLanguageGrid from "./CountryLanguageGrid";

type Props = {
  beat: TutorialBeat;
  onBack: () => void;
  onLanguage: () => void;
  onChooseTheme: () => void;
  onSurveyorName: (name: string) => void;
  onTake: () => void;
  onSkip: () => void;
};

export default function TutorialOnboarding({
  beat,
  onBack,
  onLanguage,
  onChooseTheme,
  onSurveyorName,
  onTake,
  onSkip
}: Props) {
  const t = useT();
  const [lang, setLang] = useState<TutorialLanguage | null>(loadTutorialLanguage);
  const [theme, setTheme] = useState<Theme>(() => loadTheme());
  const [name, setName] = useState(() => loadSettings().surveyorName);
  const { revealDisplay, triggerTextReveal } = useTextReveal();
  const [pitchReady, setPitchReady] = useState(false);
  const pitchIntro = t("tutorial.pitchIntro");

  useEffect(() => {
    if (beat !== "welcome") return;
    const timer = window.setTimeout(onLanguage, 1800);
    return () => window.clearTimeout(timer);
  }, [beat, onLanguage]);

  useEffect(() => {
    if (beat !== "pitch") {
      setPitchReady(false);
      return;
    }
    triggerTextReveal("", pitchIntro, { onDone: () => setPitchReady(true) });
  }, [beat, pitchIntro, triggerTextReveal]);

  const pickTheme = (next: Theme) => {
    setTheme(next);
    applyTheme(next, { animate: true });
  };

  return (
    <div className="tutorial-onboarding">
      {beat === "welcome" && (
        <h1 className="tutorial-welcome-title">{t("tutorial.welcomeTitle")}</h1>
      )}

      {beat === "language" && (
        <div className="tutorial-onboard-block tutorial-fade-in">
          <p className="tutorial-onboard-copy">{t("tutorial.languageCopy")}</p>
          <p className="tutorial-onboard-sub">{t("tutorial.changeAnytime")}</p>
          <CountryLanguageGrid
            value={lang}
            onChange={(next) => {
              setLang(next);
              setUiLanguage(next);
              window.setTimeout(onLanguage, 280);
            }}
          />
        </div>
      )}

      {beat === "theme" && (
        <div className="tutorial-onboard-block tutorial-fade-in">
          <p className="tutorial-onboard-copy">{t("tutorial.themeCopy")}</p>
          <p className="tutorial-onboard-sub">{t("tutorial.changeAnytime")}</p>
          <div className="tutorial-theme-row" role="radiogroup" aria-label={t("tutorial.themeAria")}>
            <ThemeLogo
              value="expressive"
              label={t("tutorial.themeLight")}
              swatch={t("tutorial.themeStudioSwatch")}
              active={theme === "expressive"}
              onSelect={() => pickTheme("expressive")}
            />
            <ThemeLogo
              value="dark"
              label={t("tutorial.themeDark")}
              swatch={t("tutorial.themeInkSwatch")}
              active={theme === "dark"}
              onSelect={() => pickTheme("dark")}
            />
          </div>
          <button type="button" className="btn primary tutorial-choose-theme" onClick={onChooseTheme}>
            {t("common.choose")}
          </button>
        </div>
      )}

      {beat === "surveyorName" && (
        <div className="tutorial-onboard-block tutorial-fade-in">
          <p className="tutorial-onboard-copy">{t("tutorial.nameCopy")}</p>
          <p className="tutorial-onboard-sub">{t("tutorial.nameHint")}</p>
          <label className="field">
            <input
              type="text"
              autoComplete="name"
              value={name}
              placeholder={t("tutorial.namePlaceholder")}
              aria-label={t("tutorial.nameCopy")}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim()) {
                  onSurveyorName(name.trim());
                }
              }}
            />
          </label>
          <button
            type="button"
            className="btn primary tutorial-choose-theme"
            disabled={!name.trim()}
            onClick={() => onSurveyorName(name.trim())}
          >
            {t("common.continue")}
          </button>
        </div>
      )}

      {beat === "pitch" && (
        <div className="tutorial-onboard-block tutorial-pitch">
          <p className="tutorial-pitch-intro">
            {revealDisplay !== null ? revealDisplay : pitchIntro}
          </p>
          {pitchReady && (
            <div className="tutorial-fade-in">
              <p className="tutorial-onboard-copy">{t("tutorial.pitchPrompt")}</p>
              <div className="tutorial-coach-actions">
                <button type="button" className="btn" onClick={onSkip}>
                  {t("tutorial.skip")}
                </button>
                <button type="button" className="btn primary" onClick={onTake}>
                  {t("tutorial.take")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <button type="button" className="tutorial-onboard-back" onClick={onBack}>
        {t("common.back")}
      </button>
    </div>
  );
}

function ThemeLogo({
  value,
  label,
  swatch,
  active,
  onSelect
}: {
  value: Theme;
  label: string;
  swatch: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      className={`theme-option tutorial-theme-option${active ? " active" : ""}`}
      onClick={onSelect}
    >
      <span className={`theme-swatch ${value}`} aria-hidden>
        <i />
      </span>
      <strong>{label}</strong>
      <small>{swatch}</small>
    </button>
  );
}
