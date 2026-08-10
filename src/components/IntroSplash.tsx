import { useEffect, useRef, useState, type CSSProperties } from "react";
import BrandMark from "./BrandMark";

const SESSION_KEY = "survey-report-intro-seen";

/** Spin → unravel into mark → shine (logo frozen) → smooth fly-out. */
/** Keep in sync with `intro-stroke-draw` keyframe % (spin / total stroke). */
const DASH_PERIOD_MS = 800;
const SPIN_CYCLES = 2;
const SPIN_MS = DASH_PERIOD_MS * SPIN_CYCLES;
const UNRAVEL_MS = 1100;
const STROKE_MS = SPIN_MS + UNRAVEL_MS;
const SHINE_MS = 900;
const FLY_MS = 900;
const INTRO_MS = STROKE_MS + SHINE_MS + FLY_MS;

/**
 * Logo layout phases. "settled" covers both the shine hold and the moment
 * before fly — shine is a separate flag so it cannot change logo CSS.
 */
type Phase = "boot" | "spin" | "unravel" | "settled" | "fly";

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
  const [phase, setPhase] = useState<Phase>("boot");
  const [shine, setShine] = useState(false);
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
    const timers: number[] = [];

    if (hold) {
      setPhase("settled");
      setShine(true);
      return;
    }

    // Stroke spin→fill is one CSS animation; JS phases only drive solid/shine/fly.
    const start = requestAnimationFrame(() => {
      setPhase("spin");

      let t = SPIN_MS;
      timers.push(window.setTimeout(() => setPhase("unravel"), t));
      t += UNRAVEL_MS;
      // Freeze logo styles first, then start shine on the next frame so no
      // logo rule changes in the same paint as the shine layer.
      timers.push(
        window.setTimeout(() => {
          setPhase("settled");
          requestAnimationFrame(() => setShine(true));
        }, t)
      );
      t += SHINE_MS;
      timers.push(
        window.setTimeout(() => {
          setShine(false);
          setPhase("fly");
        }, t)
      );
      timers.push(window.setTimeout(finish, INTRO_MS));
    });

    return () => {
      cancelAnimationFrame(start);
      for (const id of timers) window.clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hold]);

  const drawing = phase === "spin" || phase === "unravel";

  return (
    <div
      className={`intro-splash intro-${phase}${hold ? " intro-hold" : ""}${shine ? " is-shining" : ""}${drawing ? " is-drawing" : ""}`}
      style={{ "--intro-stroke-ms": `${STROKE_MS}ms` } as CSSProperties}
      role="dialog"
      aria-label="DampMaster"
      aria-live="polite"
      onClick={finish}
    >
      <div className="intro-logo" aria-hidden>
        <div className="intro-logo-glyph">
          <BrandMark className="intro-logo-mark" intro />
        </div>
        <span
          className="intro-shine"
          style={{
            WebkitMaskImage: `url(${import.meta.env.BASE_URL}brand/logo-mask.svg)`,
            maskImage: `url(${import.meta.env.BASE_URL}brand/logo-mask.svg)`
          }}
        />
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
