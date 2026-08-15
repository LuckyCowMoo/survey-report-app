import { useEffect, useState } from "react";
import { applyTheme, loadTheme, type Theme } from "../lib/theme";
import { useTextReveal } from "../lib/textReveal";
import {
  loadTutorialLanguage,
  saveTutorialLanguage,
  type TutorialLanguage
} from "../lib/tutorial/progress";
import type { TutorialBeat } from "../lib/tutorial/flow";
import CountryLanguageGrid from "./CountryLanguageGrid";

type Props = {
  beat: TutorialBeat;
  onBack: () => void;
  onLanguage: () => void;
  onChooseTheme: () => void;
  onTake: () => void;
  onSkip: () => void;
};

const PITCH_INTRO =
  "Dampmaster report studio is a bespoke tool created to help Dampmaster franchisees quickly and easily create notes while out in the field and seamlessly convert observations into finished documents";

export default function TutorialOnboarding({
  beat,
  onBack,
  onLanguage,
  onChooseTheme,
  onTake,
  onSkip
}: Props) {
  const [lang, setLang] = useState<TutorialLanguage | null>(loadTutorialLanguage);
  const [theme, setTheme] = useState<Theme>(() => loadTheme());
  const { revealDisplay, triggerTextReveal } = useTextReveal();
  const [pitchReady, setPitchReady] = useState(false);

  useEffect(() => {
    if (beat !== "welcome") return;
    const t = window.setTimeout(onLanguage, 1800);
    return () => window.clearTimeout(t);
  }, [beat, onLanguage]);

  useEffect(() => {
    if (beat !== "pitch") {
      setPitchReady(false);
      return;
    }
    triggerTextReveal("", PITCH_INTRO, { onDone: () => setPitchReady(true) });
  }, [beat, triggerTextReveal]);

  const pickTheme = (next: Theme) => {
    setTheme(next);
    applyTheme(next, { animate: true });
  };

  return (
    <div className="tutorial-onboarding">
      {beat === "welcome" && (
        <h1 className="tutorial-welcome-title">Welcome to Dampmaster report studio</h1>
      )}

      {beat === "language" && (
        <div className="tutorial-onboard-block tutorial-fade-in">
          <p className="tutorial-onboard-copy">
            Please choose a language: English, Welsh, Irish, Scottish
          </p>
          <p className="tutorial-onboard-sub">You can change these settings at any time</p>
          <CountryLanguageGrid
            value={lang}
            onChange={(next) => {
              setLang(next);
              saveTutorialLanguage(next);
              window.setTimeout(onLanguage, 280);
            }}
          />
        </div>
      )}

      {beat === "theme" && (
        <div className="tutorial-onboard-block tutorial-fade-in">
          <p className="tutorial-onboard-copy">Please choose a theme: light / dark</p>
          <p className="tutorial-onboard-sub">You can change these settings at any time</p>
          <div className="tutorial-theme-row" role="radiogroup" aria-label="Theme">
            <ThemeLogo
              value="expressive"
              label="Light"
              swatch="Studio"
              active={theme === "expressive"}
              onSelect={() => pickTheme("expressive")}
            />
            <ThemeLogo
              value="dark"
              label="Dark"
              swatch="Ink"
              active={theme === "dark"}
              onSelect={() => pickTheme("dark")}
            />
          </div>
          <button type="button" className="btn primary tutorial-choose-theme" onClick={onChooseTheme}>
            Choose
          </button>
        </div>
      )}

      {beat === "pitch" && (
        <div className="tutorial-onboard-block tutorial-pitch">
          <p className="tutorial-pitch-intro">
            {revealDisplay !== null ? revealDisplay : PITCH_INTRO}
          </p>
          {pitchReady && (
            <div className="tutorial-fade-in">
              <p className="tutorial-onboard-copy">
                Please consider taking this quick interactive tutorial to learn how to
                use report studio
              </p>
              <div className="tutorial-coach-actions">
                <button type="button" className="btn" onClick={onSkip}>
                  Skip
                </button>
                <button type="button" className="btn primary" onClick={onTake}>
                  Take tutorial
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <button type="button" className="tutorial-onboard-back" onClick={onBack}>
        Back
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
