import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from "react";
import {
  HOME_SCREEN_GUIDE,
  detectHomeScreenNotch,
  homeScreenGuideAtNotch,
  homeScreenNotchCount,
  type HomeScreenGuideEntry
} from "../lib/homeScreenGuide";

import homeLogo from "../assets/homescreen-logos/home.svg";
import androidLogo from "../assets/homescreen-logos/android.svg";
import chromeLogo from "../assets/homescreen-logos/chrome.svg";
import firefoxLogo from "../assets/homescreen-logos/firefox.svg";
import safariLogo from "../assets/homescreen-logos/safari.svg";
import edgeLogo from "../assets/homescreen-logos/edge.svg";

const TRACK_PIP_INSET_PX = 24;

const LOGO_SRC: Record<HomeScreenGuideEntry["logo"], string> = {
  home: homeLogo,
  android: androidLogo,
  chrome: chromeLogo,
  firefox: firefoxLogo,
  safari: safariLogo,
  edge: edgeLogo
};

function HomeMark({
  logo,
  title,
  className = "provider-key-logo-img"
}: {
  logo: HomeScreenGuideEntry["logo"];
  title: string;
  className?: string;
}) {
  return (
    <img
      className={className}
      src={LOGO_SRC[logo]}
      alt=""
      aria-label={title}
      width={40}
      height={40}
      draggable={false}
    />
  );
}

function PipMark({
  entry,
  active
}: {
  entry: HomeScreenGuideEntry;
  active: boolean;
}) {
  return (
    <img
      className={`provider-key-pip-mark home-screen-pip-mark${active ? " is-active" : ""}`}
      src={LOGO_SRC[entry.logo]}
      alt=""
      width={14}
      height={14}
      draggable={false}
    />
  );
}

export default function HomeScreenGuide() {
  const notchCount = homeScreenNotchCount();
  const maxNotch = notchCount - 1;
  const detectedNotch = detectHomeScreenNotch();
  const [notch, setNotch] = useState(detectedNotch);
  const [dragValue, setDragValue] = useState(detectedNotch);
  const [isDragging, setIsDragging] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const labelId = useId();

  const entry = homeScreenGuideAtNotch(notch);
  const visual = (isDragging ? dragValue : notch) / maxNotch;
  const isDetectedTab = notch === detectedNotch;

  const snapTo = useCallback(
    (raw: number) => {
      const clamped = Math.max(0, Math.min(maxNotch, Math.round(raw)));
      setNotch(clamped);
      setDragValue(clamped);
    },
    [maxNotch]
  );

  const valueFromClientX = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return 0;
      const rect = track.getBoundingClientRect();
      const usable = Math.max(1, rect.width - TRACK_PIP_INSET_PX * 2);
      const t = (clientX - rect.left - TRACK_PIP_INSET_PX) / usable;
      return Math.max(0, Math.min(maxNotch, t * maxNotch));
    },
    [maxNotch]
  );

  const endDrag = useCallback(
    (clientX: number) => {
      setIsDragging(false);
      snapTo(valueFromClientX(clientX));
    },
    [snapTo, valueFromClientX]
  );

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: PointerEvent) => {
      setDragValue(valueFromClientX(e.clientX));
    };
    const onUp = (e: PointerEvent) => {
      endDrag(e.clientX);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [isDragging, endDrag, valueFromClientX]);

  const onTrackPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
    setDragValue(valueFromClientX(e.clientX));
  };

  const brandStyle = {
    ["--pk-accent"]: entry.accent,
    ["--pk-panel"]: entry.panel,
    ["--pk-ink"]: entry.ink,
    ["--pk-muted"]: entry.muted
  } as CSSProperties;

  return (
    <div
      className="provider-key-guide is-branded home-screen-guide"
      style={brandStyle}
    >
      <p id={labelId} className="provider-key-slider-label">
        Slide to your device for home-screen steps
      </p>

      <div className="provider-key-slider">
        <div
          ref={trackRef}
          className="provider-key-track"
          onPointerDown={onTrackPointerDown}
          role="slider"
          tabIndex={0}
          aria-valuemin={0}
          aria-valuemax={maxNotch}
          aria-valuenow={notch}
          aria-valuetext={entry.shortName}
          aria-labelledby={labelId}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowUp") {
              e.preventDefault();
              snapTo(notch + 1);
            } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
              e.preventDefault();
              snapTo(notch - 1);
            } else if (e.key === "Home") {
              e.preventDefault();
              snapTo(0);
            } else if (e.key === "End") {
              e.preventDefault();
              snapTo(maxNotch);
            }
          }}
        >
          <div
            className={`provider-key-track-fill${isDragging ? " is-dragging" : ""}`}
            style={{
              width: `calc(${TRACK_PIP_INSET_PX * 2}px + (100% - ${TRACK_PIP_INSET_PX * 2}px) * ${visual})`
            }}
          />
          <div className="provider-key-notches">
            {HOME_SCREEN_GUIDE.map((item, i) => {
              const active = i === notch && !isDragging;
              const t = i / maxNotch;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`provider-key-notch home-screen-notch${active ? " is-active" : ""}${i === 0 ? " is-home" : ""}${i === detectedNotch ? " is-detected" : ""}`}
                  style={{
                    left: `calc(${TRACK_PIP_INSET_PX}px + (100% - ${TRACK_PIP_INSET_PX * 2}px) * ${t})`
                  }}
                  tabIndex={-1}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsDragging(false);
                    snapTo(i);
                  }}
                  aria-label={
                    i === detectedNotch
                      ? `${item.shortName} (detected for this device)`
                      : item.shortName
                  }
                >
                  <PipMark entry={item} active={active} />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div key={entry.id} className="provider-key-panel provider-key-panel-brand">
          <div className="provider-key-hero home-screen-hero">
          <div className="provider-key-logo-wrap">
            <HomeMark
              logo={entry.logo}
              title={entry.title}
              className={
                entry.logo === "home"
                  ? "provider-key-logo-img provider-key-logo-home"
                  : "provider-key-logo-img"
              }
            />
          </div>
          <div className="provider-key-name-wrap">
            <p className="provider-key-company">{entry.subtitle}</p>
            <h4 className="provider-key-name">{entry.title}</h4>
          </div>
        </div>
        {isDetectedTab && (
          <p className="home-screen-detected" role="status">
            This is the correct tab for the browser you’re using now.
          </p>
        )}
        <div className="provider-key-setup">
          <ol className="guide-steps">
            {entry.steps.map((step) => (
              <li key={step.text}>{step.text}</li>
            ))}
          </ol>
          {entry.note && <p className="provider-key-note">{entry.note}</p>}
        </div>
      </div>
    </div>
  );
}
