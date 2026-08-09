import { useEffect, useRef, useState } from "react";
import BrandMark from "./BrandMark";

const SESSION_KEY = "survey-report-intro-seen";
const INTRO_MS = 2600;

function introParams(): { force: boolean; hold: boolean } {
  const params = new URLSearchParams(window.location.search);
  return {
    force: params.has("intro"),
    hold: params.get("intro") === "hold"
  };
}

function shouldPlayIntro(): boolean {
  if (introParams().force) return true;
  try {
    if (sessionStorage.getItem(SESSION_KEY) === "1") return false;
  } catch {
    /* private mode / blocked storage - still play once this mount */
  }
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    try {
      sessionStorage.setItem(SESSION_KEY, "1");
    } catch {
      /* ignore */
    }
    return false;
  }
  return true;
}

function markSeen(): void {
  try {
    sessionStorage.setItem(SESSION_KEY, "1");
  } catch {
    /* ignore */
  }
}

interface Props {
  onDone: () => void;
}

export default function IntroSplash({ onDone }: Props) {
  const hold = introParams().hold;
  const [phase, setPhase] = useState<"boot" | "play">("boot");
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const finished = useRef(false);

  const finish = () => {
    if (hold || finished.current) return;
    finished.current = true;
    markSeen();
    onDoneRef.current();
  };

  useEffect(() => {
    const start = requestAnimationFrame(() => setPhase("play"));
    if (hold) {
      return () => cancelAnimationFrame(start);
    }
    const done = window.setTimeout(finish, INTRO_MS);
    return () => {
      cancelAnimationFrame(start);
      window.clearTimeout(done);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hold]);

  return (
    <div
      className={`intro-splash intro-${phase}${hold ? " intro-hold" : ""}`}
      role="dialog"
      aria-label="DampMaster"
      aria-live="polite"
      onClick={finish}
    >
      <div className="intro-logo" aria-hidden>
        <div className="intro-logo-glyph">
          <BrandMark className="intro-logo-mark" />
          <span className="intro-shine" />
        </div>
      </div>
      {!hold && (
        <button
          className="intro-skip"
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            finish();
          }}
        >
          Skip
        </button>
      )}
    </div>
  );
}

export function useIntroSplash(): {
  showIntro: boolean;
  dismissIntro: () => void;
} {
  const [showIntro, setShowIntro] = useState(() => {
    if (typeof window === "undefined") return false;
    return shouldPlayIntro();
  });

  const dismissIntro = () => {
    markSeen();
    setShowIntro(false);
  };

  return { showIntro, dismissIntro };
}
