import { useEffect, useRef, useState, type CSSProperties } from "react";
import BrandMark from "./BrandMark";

const SESSION_KEY = "survey-report-intro-seen";

/** Spin → unravel → shine → portal zoom through a window pane. */
const DASH_PERIOD_MS = 800;
/** First stop check after this many full chase circles. */
const MIN_SPIN_CYCLES = 2;
/** At each stop boundary: chance to run one more circle, then check again. */
const EXTRA_CIRCLE_CHANCE = 1 / 3;
const UNRAVEL_MS = 1100;
/** Matches `.intro-mark-solid` opacity transition (delay + duration). */
const FILL_MS = 900;
const SHINE_MS = 900;
const PORTAL_MS = 1400;

/**
 * Logo layout phases. "settled" covers the shine hold.
 * "portal" zooms through a light window square into the app.
 */
type Phase = "boot" | "spin" | "unravel" | "settled" | "portal";

/** viewBox 129.92×42.97 — top-right light pane center, as % of the logo box */
const PORTAL_ORIGIN_X = "49.07%";
const PORTAL_ORIGIN_Y = "68.07%";

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

    const start = requestAnimationFrame(() => {
      setPhase("spin");

      const beginUnravel = () => {
        setPhase("unravel");
        // Shine as soon as the solid fill finishes — no pause after “full”
        timers.push(window.setTimeout(() => setShine(true), FILL_MS));
        timers.push(window.setTimeout(() => setPhase("settled"), UNRAVEL_MS));
        timers.push(
          window.setTimeout(() => {
            setShine(false);
            setPhase("portal");
          }, FILL_MS + SHINE_MS)
        );
        timers.push(
          window.setTimeout(finish, FILL_MS + SHINE_MS + PORTAL_MS)
        );
      };

      /** At a cycle boundary: 25% another circle, else end the loading chase. */
      const decideSpinStop = () => {
        if (Math.random() < EXTRA_CIRCLE_CHANCE) {
          timers.push(window.setTimeout(decideSpinStop, DASH_PERIOD_MS));
          return;
        }
        beginUnravel();
      };

      timers.push(
        window.setTimeout(decideSpinStop, MIN_SPIN_CYCLES * DASH_PERIOD_MS)
      );
    });

    return () => {
      cancelAnimationFrame(start);
      for (const id of timers) window.clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hold]);

  return (
    <div
      className={`intro-splash intro-${phase}${hold ? " intro-hold" : ""}${shine ? " is-shining" : ""}`}
      style={
        {
          "--intro-dash-period": `${DASH_PERIOD_MS}ms`,
          "--intro-unravel-ms": `${UNRAVEL_MS}ms`,
          "--intro-portal-ms": `${PORTAL_MS}ms`,
          "--intro-portal-x": PORTAL_ORIGIN_X,
          "--intro-portal-y": PORTAL_ORIGIN_Y
        } as CSSProperties
      }
      role="dialog"
      aria-label="DampMaster"
      aria-live="polite"
      onClick={finish}
    >
      <div className="intro-zoom" aria-hidden>
        {/* Full-bleed matte with holes at the light window panes.
            Scales with the logo so the portal grows into the viewport. */}
        <svg
          className="intro-matte"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 129.92 42.97"
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <mask
              id="intro-matte-holes"
              maskUnits="userSpaceOnUse"
              x="-6000"
              y="-6000"
              width="12000"
              height="12000"
            >
              <rect x="-6000" y="-6000" width="12000" height="12000" fill="#fff" />
              <rect x="61.84" y="27.14" width="3.82" height="4.22" fill="#000" />
              <rect x="56.4" y="32.61" width="3.69" height="4.22" fill="#000" />
              <rect x="61.84" y="32.61" width="3.82" height="4.22" fill="#000" />
            </mask>
          </defs>
          <rect
            className="intro-matte-fill"
            x="-6000"
            y="-6000"
            width="12000"
            height="12000"
            fill="#050505"
            mask="url(#intro-matte-holes)"
          />
        </svg>

        <div className="intro-logo">
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
