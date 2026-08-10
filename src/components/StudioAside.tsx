import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { imagePreviewUrl } from "../lib/imageUtils";
import type { SectionState } from "../types";

type FlowStep = "review" | "details" | "generate";

interface Props {
  step: FlowStep;
  sections: SectionState[];
  focusedIndex: number;
  /** Section the user is actively dwelling on (review only); drives yellow→green fill. */
  dwellIndex: number | null;
  /** Section currently being written by AI (slow purple fill). */
  busySectionIndex: number | null;
  /** Entry numbers of sections with an active AI error overlay. */
  aiErrorSectionNums?: ReadonlySet<number>;
  onJumpSection?: (index: number) => void;
  /** Fired when a pending-review pip fill reaches full green. */
  onDwellComplete?: (index: number) => void;
}

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
/** Time focused on a yellow pip to fill it fully green. */
const PIP_DWELL_MS = 5000;
/** Time for a partial green fill to drain back to yellow after leaving early. */
const PIP_REVERSE_MS = 2800;
/** Default top→bottom colour transition for status changes. */
const PIP_TRANSITION_MS = 660;
/** Slow crawl toward purple while AI is generating a section. */
const PIP_AI_FILL_MS = 4800;
const PIP_FLASH_MS = 480;
/** Mexican-wave pulse when moving between review / details / generate. */
const PIP_WAVE_MS = 350;
const PIP_WAVE_STAGGER_MS = 32;

const FLOW_ORDER: FlowStep[] = ["review", "details", "generate"];

type PipTone = "attention" | "review" | "ai" | "library" | "manual" | "empty";

const PIP_COLORS: Record<PipTone, string> = {
  attention: "#ff5a36",
  review: "#eab308",
  ai: "#8b5cf6",
  library: "#22a06b",
  manual: "#3b82f6",
  empty: "rgba(148, 163, 184, 0.45)"
};

interface PipAnim {
  from: PipTone;
  to: PipTone;
  progress: number;
}

function pickDetailsHero(exclude?: string) {
  const pool = exclude ? DETAILS_HEROES.filter((h) => h !== exclude) : DETAILS_HEROES;
  return pool[Math.floor(Math.random() * pool.length)] ?? DETAILS_HEROES[0];
}

function easeInOut(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** Settled pip colour from section status (ignores in-flight AI). */
function pipTone(s: SectionState): PipTone {
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

function effectiveTone(anim: PipAnim): PipTone {
  return anim.progress >= 0.5 ? anim.to : anim.from;
}

/** Desktop aside: left column is the scroll root; otherwise the window. */
function getScrollRoot(): HTMLElement | null {
  if (typeof window === "undefined") return null;
  if (!window.matchMedia("(min-width: 1100px)").matches) return null;
  return document.querySelector<HTMLElement>(".app.app-aside .content");
}

function readScrollState(): { progress: number; thumb: number } {
  const root = getScrollRoot();
  if (root) {
    const max = root.scrollHeight - root.clientHeight;
    const progress = max > 0 ? Math.min(1, Math.max(0, root.scrollTop / max)) : 0;
    const thumb =
      max > 0
        ? Math.min(0.85, Math.max(0.12, root.clientHeight / root.scrollHeight))
        : 1;
    return { progress, thumb };
  }
  const max = document.documentElement.scrollHeight - window.innerHeight;
  const progress = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
  const thumb =
    max > 0
      ? Math.min(
          0.85,
          Math.max(0.12, window.innerHeight / document.documentElement.scrollHeight)
        )
      : 1;
  return { progress, thumb };
}

function scrollToProgress(progress: number) {
  const clamped = Math.min(1, Math.max(0, progress));
  const root = getScrollRoot();
  if (root) {
    const max = root.scrollHeight - root.clientHeight;
    root.scrollTo({ top: Math.max(0, max * clamped) });
    return;
  }
  const max = document.documentElement.scrollHeight - window.innerHeight;
  window.scrollTo({ top: Math.max(0, max * clamped) });
}

function startTransition(anim: PipAnim, to: PipTone): PipAnim {
  if (anim.to === to && anim.progress < 1) return anim;
  if (anim.to === to && anim.progress >= 1) return anim;
  if (anim.progress >= 1) return { from: anim.to, to, progress: 0 };
  return { from: effectiveTone(anim), to, progress: 0 };
}

/** Wide-desktop companion panel: focused photo + flow bar, pips, scroll rail. */
export default function StudioAside({
  step,
  sections,
  focusedIndex,
  dwellIndex,
  busySectionIndex,
  aiErrorSectionNums,
  onJumpSection,
  onDwellComplete
}: Props) {
  const section =
    sections[Math.min(Math.max(focusedIndex, 0), Math.max(sections.length - 1, 0))];
  const [url, setUrl] = useState<string | null>(null);
  const [studioHero, setStudioHero] = useState(() => pickDetailsHero());
  const [scroll, setScroll] = useState({ progress: 0, thumb: 0.2 });
  const [pipAnims, setPipAnims] = useState<Map<number, PipAnim>>(() => new Map());
  const [flashingPips, setFlashingPips] = useState<Set<number>>(() => new Set());
  const [pipWaves, setPipWaves] = useState<
    Array<{ id: number; direction: "forward" | "reverse" }>
  >([]);
  const pipAnimsRef = useRef<Map<number, PipAnim>>(new Map());
  const dwellCompleteFiredRef = useRef<Set<number>>(new Set());
  const flashTimersRef = useRef<Map<number, number>>(new Map());
  const waveIdRef = useRef(0);
  const waveTimeoutsRef = useRef<Map<number, number>>(new Map());
  const prevStepRef = useRef<FlowStep | null>(null);
  const onDwellCompleteRef = useRef(onDwellComplete);
  onDwellCompleteRef.current = onDwellComplete;
  const trackRef = useRef<HTMLDivElement>(null);
  const photoRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; startY: number; startProgress: number } | null>(
    null
  );

  const flashPip = (num: number) => {
    setFlashingPips((prev) => {
      const next = new Set(prev);
      next.add(num);
      return next;
    });
    const existing = flashTimersRef.current.get(num);
    if (existing !== undefined) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
      flashTimersRef.current.delete(num);
      setFlashingPips((prev) => {
        if (!prev.has(num)) return prev;
        const next = new Set(prev);
        next.delete(num);
        return next;
      });
    }, PIP_FLASH_MS);
    flashTimersRef.current.set(num, timer);
  };

  useEffect(() => {
    return () => {
      for (const timer of flashTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      flashTimersRef.current.clear();
      for (const timer of waveTimeoutsRef.current.values()) {
        window.clearTimeout(timer);
      }
      waveTimeoutsRef.current.clear();
    };
  }, []);

  const enqueuePipWave = (direction: "forward" | "reverse", count: number) => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (count <= 0) return;
    const id = ++waveIdRef.current;
    setPipWaves((prev) => [...prev, { id, direction }]);
    const done = window.setTimeout(
      () => {
        waveTimeoutsRef.current.delete(id);
        setPipWaves((prev) => prev.filter((w) => w.id !== id));
      },
      count * PIP_WAVE_STAGGER_MS + PIP_WAVE_MS + 80
    );
    waveTimeoutsRef.current.set(id, done);
  };

  // Mexican waves: forward on continue / first review appear; reverse on back.
  // Multiple waves can overlap if the user navigates quickly.
  useEffect(() => {
    const prev = prevStepRef.current;
    prevStepRef.current = step;
    if (sections.length === 0) return;

    let direction: "forward" | "reverse" | null = null;
    if (prev === null && step === "review") {
      direction = "forward";
    } else if (prev !== null && prev !== step) {
      const prevIdx = FLOW_ORDER.indexOf(prev);
      const nextIdx = FLOW_ORDER.indexOf(step);
      if (prevIdx >= 0 && nextIdx >= 0) {
        if (nextIdx === prevIdx + 1) direction = "forward";
        else if (nextIdx === prevIdx - 1) direction = "reverse";
      }
    }
    if (!direction) return;
    enqueuePipWave(direction, sections.length);
  }, [step, sections.length]);

  // Unified pip colour transitions: dwell, AI crawl, and 1s status changes.
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let raf = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(48, now - last);
      last = now;
      const next = new Map(pipAnimsRef.current);
      let changed = false;

      const activeDwellNum =
        step === "review" &&
        dwellIndex !== null &&
        sections[dwellIndex]?.pendingReview
          ? sections[dwellIndex].entry.number
          : null;

      const busyNum =
        busySectionIndex !== null && sections[busySectionIndex]
          ? sections[busySectionIndex].entry.number
          : null;

      for (const s of sections) {
        const num = s.entry.number;
        const settled = pipTone(s);
        let anim = next.get(num);
        if (!anim) {
          anim = { from: settled, to: settled, progress: 1 };
          next.set(num, anim);
          changed = true;
        }

        const aiWorking = busyNum === num;
        const dwelling = activeDwellNum === num;
        let updated = anim;

        if (aiWorking) {
          updated = startTransition(anim, "ai");
          if (reduced) {
            updated = { from: "ai", to: "ai", progress: 1 };
          } else {
            // Creep toward purple but hold just shy of full until the request ends.
            updated = {
              ...updated,
              progress: Math.min(0.9, updated.progress + dt / PIP_AI_FILL_MS)
            };
          }
        } else if (s.pendingReview) {
          if (dwelling) {
            if (anim.to === "library" && anim.from === "review") {
              updated = {
                ...anim,
                progress: Math.min(1, anim.progress + (reduced ? 1 : dt / PIP_DWELL_MS))
              };
            } else {
              updated = { from: "review", to: "library", progress: reduced ? 1 : 0 };
              if (anim.to === "library" && anim.progress > 0) {
                updated = { from: "review", to: "library", progress: anim.progress };
              }
            }
            if (updated.progress >= 1 && !dwellCompleteFiredRef.current.has(num)) {
              dwellCompleteFiredRef.current.add(num);
              flashPip(num);
              const idx = sections.findIndex((x) => x.entry.number === num);
              if (idx >= 0) onDwellCompleteRef.current?.(idx);
            }
          } else if (anim.to === "library" && anim.from === "review" && anim.progress > 0) {
            updated = {
              ...anim,
              progress: Math.max(0, anim.progress - (reduced ? 1 : dt / PIP_REVERSE_MS))
            };
            dwellCompleteFiredRef.current.delete(num);
          } else if (anim.to !== "review" || anim.progress < 1) {
            updated = startTransition(anim, "review");
            if (updated.progress < 1) {
              const before = updated.progress;
              updated = {
                ...updated,
                progress: Math.min(1, updated.progress + (reduced ? 1 : dt / PIP_TRANSITION_MS))
              };
              if (before < 1 && updated.progress >= 1 && updated.from !== updated.to) {
                flashPip(num);
              }
            }
          }
        } else {
          dwellCompleteFiredRef.current.delete(num);
          updated = startTransition(anim, settled);
          if (updated.progress < 1) {
            const before = updated.progress;
            updated = {
              ...updated,
              progress: Math.min(1, updated.progress + (reduced ? 1 : dt / PIP_TRANSITION_MS))
            };
            if (before < 1 && updated.progress >= 1 && updated.from !== updated.to) {
              flashPip(num);
            }
          }
        }

        if (updated.progress >= 1) {
          updated = { from: updated.to, to: updated.to, progress: 1 };
        }

        if (
          updated.from !== anim.from ||
          updated.to !== anim.to ||
          updated.progress !== anim.progress
        ) {
          next.set(num, updated);
          changed = true;
        }
      }

      for (const num of [...next.keys()]) {
        if (!sections.some((s) => s.entry.number === num)) {
          next.delete(num);
          changed = true;
        }
      }

      if (changed) {
        pipAnimsRef.current = next;
        setPipAnims(new Map(next));
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [step, dwellIndex, busySectionIndex, sections]);

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
    const update = () => setScroll(readScrollState());
    update();
    // Capture so desktop content-column scrolling is tracked, not only window.
    document.addEventListener("scroll", update, { passive: true, capture: true });
    window.addEventListener("resize", update);
    return () => {
      document.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [sections.length, step]);

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
        <div className="studio-pips" aria-label="Section status">
          {sections.map((s, i) => {
            const current = step === "review" && i === focusedIndex;
            const errored = aiErrorSectionNums?.has(s.entry.number) ?? false;
            const anim = pipAnims.get(s.entry.number) ?? {
              from: pipTone(s),
              to: pipTone(s),
              progress: 1
            };
            const filling = !errored && anim.progress < 1;
            const flashing = !errored && flashingPips.has(s.entry.number);
            const tone = errored ? "error" : filling ? anim.from : anim.to;
            const fillStyle = filling
              ? ({
                  background: PIP_COLORS[anim.from],
                  ["--dwell-fill"]: anim.progress.toFixed(4),
                  ["--pip-to"]: PIP_COLORS[anim.to]
                } as CSSProperties)
              : undefined;
            return (
              <button
                key={s.entry.number}
                type="button"
                className={`studio-pip tone-${tone}${filling ? " is-filling" : ""}${flashing ? " is-flash" : ""}${current ? " is-current" : ""}`}
                style={fillStyle}
                title={
                  errored
                    ? `Section ${s.entry.number} — AI error`
                    : `Section ${s.entry.number}`
                }
                aria-label={
                  errored
                    ? `Section ${s.entry.number}, AI error`
                    : filling
                      ? `Section ${s.entry.number}, changing status ${Math.round(anim.progress * 100)}%`
                      : `Section ${s.entry.number}, ${tone}`
                }
                aria-current={current ? "true" : undefined}
                onClick={() => {
                  if (step !== "review") return;
                  onJumpSection?.(i);
                  document
                    .getElementById(`section-card-${s.entry.number}`)
                    ?.scrollIntoView({ behavior: "smooth", block: "center" });
                }}
              >
                {pipWaves.map((w) => (
                  <span
                    key={w.id}
                    className="studio-pip-wave-pulse"
                    aria-hidden
                    style={
                      {
                        ["--wave-delay"]: `${
                          (w.direction === "reverse" ? sections.length - 1 - i : i) *
                          PIP_WAVE_STAGGER_MS
                        }ms`
                      } as CSSProperties
                    }
                  />
                ))}
              </button>
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
