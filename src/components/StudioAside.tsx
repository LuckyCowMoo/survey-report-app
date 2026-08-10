import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { imagePreviewUrl } from "../lib/imageUtils";
import type { SectionState } from "../types";

type FlowStep = "review" | "details" | "generate";

interface Props {
  step: FlowStep;
  sections: SectionState[];
  focusedIndex: number;
  onJumpSection?: (index: number) => void;
}

const FLOW: { id: FlowStep; label: string }[] = [
  { id: "review", label: "Review" },
  { id: "details", label: "Details" },
  { id: "generate", label: "Generate" }
];

const BASE = import.meta.env.BASE_URL;
/** Rotating heroes for details / generate (no section photo to preview). */
const DETAILS_HEROES = [
  `${BASE}studio/details-1.jpg`,
  `${BASE}studio/details-2.jpg`,
  `${BASE}studio/details-3.jpg`,
  `${BASE}studio/details-4.jpg`
];

const PAN_SPEED = 0.012; // fraction of overflow range per second (almost imperceptible)
const PAN_PAUSE_MIN_MS = 2500;
const PAN_PAUSE_MAX_MS = 5500;
const PAN_MIN_DURATION = 18;

function pickDetailsHero(exclude?: string) {
  const pool = exclude ? DETAILS_HEROES.filter((h) => h !== exclude) : DETAILS_HEROES;
  return pool[Math.floor(Math.random() * pool.length)] ?? DETAILS_HEROES[0];
}

function easeInOut(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

function stepIndex(step: FlowStep) {
  return FLOW.findIndex((s) => s.id === step);
}

/** Pip colour key from section status. */
function pipTone(
  s: SectionState
): "attention" | "review" | "ai" | "library" | "manual" | "empty" {
  if (s.needsAttention) return "attention";
  if (s.pendingReview) return "review";
  switch (s.source) {
    case "ai":
      return "ai";
    case "library":
      return "library";
    case "manual":
    case "crossref":
      return "manual";
    default:
      return "empty";
  }
}

/** Wide-desktop companion panel: focused photo + flow bar, pips, scroll rail. */
export default function StudioAside({
  step,
  sections,
  focusedIndex,
  onJumpSection
}: Props) {
  const section =
    sections[Math.min(Math.max(focusedIndex, 0), Math.max(sections.length - 1, 0))];
  const [url, setUrl] = useState<string | null>(null);
  const [studioHero, setStudioHero] = useState(() => pickDetailsHero());
  const [scroll, setScroll] = useState({ progress: 0, thumb: 0.2 });
  const trackRef = useRef<HTMLDivElement>(null);
  const photoRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; startY: number; startProgress: number } | null>(
    null
  );

  useEffect(() => {
    if (step !== "review") {
      setUrl(null);
      return;
    }
    if (!section?.entry.images.length) {
      setUrl(null);
      return;
    }
    const next = imagePreviewUrl(section.entry.images[0], section.entry.imageNames[0]);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [step, section?.entry.images, section?.entry.imageNames, section?.entry.number]);

  // Fresh random hero each time details or generate is opened.
  useEffect(() => {
    if (step !== "details" && step !== "generate") return;
    setStudioHero((prev) => pickDetailsHero(prev));
  }, [step]);

  // Slow pan between random positions (haze-style ease-in-out hops).
  useEffect(() => {
    if (step !== "details" && step !== "generate") return;
    const el = photoRef.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.style.setProperty("--pan-x", "0.5");
      el.style.setProperty("--pan-y", "0.5");
      return;
    }

    let x = 0.2 + Math.random() * 0.6;
    let y = 0.2 + Math.random() * 0.6;
    let sx = x;
    let sy = y;
    let tx = Math.random();
    let ty = Math.random();
    let t = 0;
    let duration = Math.max(
      PAN_MIN_DURATION,
      Math.hypot(tx - sx, ty - sy) / PAN_SPEED
    );
    let pauseUntil = Number.POSITIVE_INFINITY;
    let raf = 0;
    let last = performance.now();

    el.style.setProperty("--pan-x", x.toFixed(4));
    el.style.setProperty("--pan-y", y.toFixed(4));

    const tick = (now: number) => {
      const dt = Math.min(48, now - last) / 1000;
      last = now;

      if (t >= 1) {
        x = tx;
        y = ty;
        if (pauseUntil === Number.POSITIVE_INFINITY) {
          pauseUntil =
            now + PAN_PAUSE_MIN_MS + Math.random() * (PAN_PAUSE_MAX_MS - PAN_PAUSE_MIN_MS);
        } else if (now >= pauseUntil) {
          sx = x;
          sy = y;
          tx = Math.random();
          ty = Math.random();
          t = 0;
          duration = Math.max(
            PAN_MIN_DURATION,
            Math.hypot(tx - sx, ty - sy) / PAN_SPEED
          );
          pauseUntil = Number.POSITIVE_INFINITY;
        }
      } else {
        t = Math.min(1, t + dt / duration);
        const u = easeInOut(t);
        x = sx + (tx - sx) * u;
        y = sy + (ty - sy) * u;
        pauseUntil = Number.POSITIVE_INFINITY;
      }

      el.style.setProperty("--pan-x", x.toFixed(4));
      el.style.setProperty("--pan-y", y.toFixed(4));
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [step, studioHero]);

  useEffect(() => {
    const update = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const progress = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      const thumb =
        max > 0
          ? Math.min(
              0.85,
              Math.max(0.12, window.innerHeight / document.documentElement.scrollHeight)
            )
          : 1;
      setScroll({ progress, thumb });
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [sections.length, step]);

  const scrollToProgress = (progress: number) => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo({ top: Math.max(0, max * Math.min(1, Math.max(0, progress))) });
  };

  const onThumbPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    dragRef.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      startProgress: scroll.progress
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onThumbPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    const track = trackRef.current;
    if (!drag || drag.pointerId !== e.pointerId || !track) return;
    const trackH = track.clientHeight;
    const thumbH = trackH * scroll.thumb;
    const travel = Math.max(1, trackH - thumbH);
    const delta = (e.clientY - drag.startY) / travel;
    scrollToProgress(drag.startProgress + delta);
  };

  const onThumbPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragRef.current?.pointerId !== e.pointerId) return;
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  };

  const onTrackPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const thumbH = rect.height * scroll.thumb;
    const y = e.clientY - rect.top - thumbH / 2;
    const travel = Math.max(1, rect.height - thumbH);
    scrollToProgress(y / travel);
  };

  const active = stepIndex(step);
  const thumbTop = scroll.progress * (1 - scroll.thumb) * 100;
  const thumbHeight = scroll.thumb * 100;

  const reviewCaption =
    section?.headingLine?.trim() ||
    section?.entry.note?.trim() ||
    (section ? `Section ${section.entry.number}` : "No section");
  const useStudioHero = step === "details" || step === "generate";
  const photoSrc = useStudioHero ? studioHero : url;
  const heroCaption = step === "generate" ? "Generate report" : "Report details";

  return (
    <aside className="studio-aside" aria-label="Studio preview">
      <div
        ref={photoRef}
        className={`studio-aside-photo${useStudioHero ? " is-details" : ""}`}
      >
        {photoSrc ? (
          <img
            key={photoSrc}
            src={photoSrc}
            alt={useStudioHero ? "Stack of survey reports" : ""}
          />
        ) : (
          <div className="studio-aside-empty">
            <span>No photo</span>
            <small>Focus a section to preview it here</small>
          </div>
        )}
        {step === "review" && section && (
          <div className="studio-aside-caption">
            <span className="studio-aside-num">({section.entry.number})</span>
            <span className="studio-aside-caption-text">{reviewCaption}</span>
          </div>
        )}
        {useStudioHero && (
          <div className="studio-aside-caption">
            <span className="studio-aside-caption-text">{heroCaption}</span>
          </div>
        )}
      </div>

      <div className="studio-aside-tools">
        <div className="progress-spine" role="list" aria-label="Report stages">
          {FLOW.map((item, i) => {
            const state = i < active ? "is-done" : i === active ? "is-current" : "is-todo";
            return (
              <div key={item.id} className={`progress-spine-seg ${state}`} role="listitem">
                <span className="progress-spine-label">{item.label}</span>
              </div>
            );
          })}
        </div>

        <div className="studio-pips" aria-label="Section status">
          {sections.map((s, i) => {
            const current = step === "review" && i === focusedIndex;
            return (
              <button
                key={s.entry.number}
                type="button"
                className={`studio-pip tone-${pipTone(s)}${current ? " is-current" : ""}`}
                title={`Section ${s.entry.number}`}
                aria-label={`Section ${s.entry.number}, ${pipTone(s)}`}
                aria-current={current ? "true" : undefined}
                onClick={() => {
                  if (step !== "review") return;
                  onJumpSection?.(i);
                  document
                    .getElementById(`section-card-${s.entry.number}`)
                    ?.scrollIntoView({ behavior: "smooth", block: "center" });
                }}
              />
            );
          })}
        </div>

        <div
          className="studio-scroll"
          ref={trackRef}
          onPointerDown={onTrackPointerDown}
          role="scrollbar"
          aria-orientation="vertical"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(scroll.progress * 100)}
          aria-label="Page scroll"
        >
          <button
            type="button"
            className="studio-scroll-thumb"
            style={{ top: `${thumbTop}%`, height: `${thumbHeight}%` }}
            aria-label="Drag to scroll"
            onPointerDown={onThumbPointerDown}
            onPointerMove={onThumbPointerMove}
            onPointerUp={onThumbPointerUp}
            onPointerCancel={onThumbPointerUp}
          />
        </div>
      </div>
    </aside>
  );
}
