import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from "react";
import { createPortal } from "react-dom";
import { imagePreviewUrl } from "../lib/imageUtils";
import { PIP_DWELL_MS, PIP_FLASH_MS, PIP_REVERSE_MS } from "../lib/pipTiming";
import { scrollElementIntoViewCentered } from "../lib/scrollRoot";
import { matchesStudioLayout } from "../lib/studioLayout";
import { useT } from "../lib/i18n";
import type { SectionState } from "../types";

const LOUPE_ZOOM_DEFAULT = 2.65;
const LOUPE_ZOOM_MIN = 1.25;
const LOUPE_ZOOM_MAX = 8;
const LOUPE_ZOOM_STEP = 0.18;

type LoupeView = {
  src: string;
  imgW: number;
  imgH: number;
  left: number;
  top: number;
  shell: { left: number; top: number; width: number; height: number };
  /** Crop outline on the studio photo, in photo-local px. */
  outline: { left: number; top: number; width: number; height: number };
};

/** Map pointer on an object-fit:cover image to 0–1 of the natural bitmap. */
function coverFocus(
  img: HTMLImageElement,
  clientX: number,
  clientY: number
): {
  nx: number;
  ny: number;
  dispW: number;
  dispH: number;
  ox: number;
  oy: number;
  imgRect: DOMRect;
  inside: boolean;
} {
  const rect = img.getBoundingClientRect();
  const nw = img.naturalWidth || 1;
  const nh = img.naturalHeight || 1;
  const scale = Math.max(rect.width / nw, rect.height / nh);
  const dispW = nw * scale;
  const dispH = nh * scale;
  const ox = (rect.width - dispW) / 2;
  const oy = (rect.height - dispH) / 2;
  const x = (clientX - rect.left - ox) / dispW;
  const y = (clientY - rect.top - oy) / dispH;
  return {
    nx: Math.min(1, Math.max(0, x)),
    ny: Math.min(1, Math.max(0, y)),
    dispW,
    dispH,
    ox,
    oy,
    imgRect: rect,
    inside: x >= 0 && x <= 1 && y >= 0 && y <= 1
  };
}

/** Loupe panel: 67% of the left column, centred in that column. */
function leftColumnShell(): LoupeView["shell"] | null {
  const content = document.querySelector<HTMLElement>(".app.app-aside .content");
  if (!content) return null;
  const r = content.getBoundingClientRect();
  if (r.width < 80 || r.height < 80) return null;
  const width = r.width * 0.67;
  const height = r.height * 0.67;
  return {
    left: r.left + (r.width - width) / 2,
    top: r.top + (r.height - height) / 2,
    width,
    height
  };
}

type FlowStep = "review" | "details" | "generate";

interface Props {
  step: FlowStep;
  sections: SectionState[];
  focusedIndex: number | null;
  /** Section the user is actively dwelling on (review only); drives yellow→green / stripe→blue fill. */
  dwellIndex: number | null;
  /** Section currently being written by AI (slow purple fill). */
  busySectionIndex: number | null;
  /** Entry numbers of sections with an active AI error overlay. */
  aiErrorSectionNums?: ReadonlySet<number>;
  /** When true, hovering a review pip jumps to that section; otherwise click/tap. */
  pipJumpOnHover?: boolean;
  /**
   * When true, studio photo scrolls through in-between section images on long jumps.
   */
  studioPhotoPassThrough?: boolean;
  /** Review only: show the current section wording instead of the photo. */
  showSectionText?: boolean;
  onJumpSection?: (index: number) => void;
  /** Fired when a pending-review / note-confirm pip fill reaches completion. */
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
/** Default top→bottom colour transition for status changes. */
const PIP_TRANSITION_MS = 660;
/** Slow crawl toward purple while AI is generating a section. */
const PIP_AI_FILL_MS = 4800;
/** Mexican-wave pulse when moving between review / details / generate. */
const PIP_WAVE_MS = 350;
const PIP_WAVE_STAGGER_MS = 32;
/** Review studio photo slide when the focused section changes. */
const PHOTO_SLIDE_MS = 480;
/** Per in-between frame when pass-through scrolling is on. */
const PHOTO_PASS_STEP_MS = 220;
const PHOTO_PASS_MAX_MS = 1600;

const FLOW_ORDER: FlowStep[] = ["review", "details", "generate"];

type SlideDir = "up" | "down";

type ReviewSlide = {
  src: string;
  /** True when src is a blob: object URL that must be revoked. */
  objectUrl: boolean;
  sectionNum: number | null;
};

type PipTone =
  | "attention"
  | "noteConfirm"
  | "review"
  | "ai"
  | "library"
  | "manual"
  | "empty";

const PIP_COLORS: Record<PipTone, string> = {
  // Hardcoded — same as .btn.primary / --brand; avoid var() on <button> (UA dark remap).
  attention: "#ff5a36",
  noteConfirm: "#eab308",
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
  if (s.pendingNoteConfirm) return "noteConfirm";
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

function isDwellPending(s: SectionState): boolean {
  return s.pendingReview || s.pendingNoteConfirm;
}

/** Target tone while dwelling on a pending pip. */
function dwellTarget(s: SectionState): PipTone {
  return s.pendingNoteConfirm ? "manual" : "library";
}

/** Starting tone for a dwell fill. */
function dwellFrom(s: SectionState): PipTone {
  return s.pendingNoteConfirm ? "noteConfirm" : "review";
}

function effectiveTone(anim: PipAnim): PipTone {
  return anim.progress >= 0.5 ? anim.to : anim.from;
}

/** Desktop aside: left column is the scroll root; otherwise the window. */
function getScrollRoot(): HTMLElement | null {
  if (typeof window === "undefined") return null;
  if (!matchesStudioLayout()) return null;
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
  pipJumpOnHover = true,
  studioPhotoPassThrough = false,
  showSectionText = false,
  onJumpSection,
  onDwellComplete
}: Props) {
  const t = useT();
  const section =
    focusedIndex == null
      ? undefined
      : sections[
          Math.min(Math.max(focusedIndex, 0), Math.max(sections.length - 1, 0))
        ];
  const [reviewSlide, setReviewSlide] = useState<ReviewSlide | null>(null);
  const [reviewOutgoing, setReviewOutgoing] = useState<{
    slide: ReviewSlide;
    dir: SlideDir;
  } | null>(null);
  const [reviewPass, setReviewPass] = useState<{
    frames: ReviewSlide[];
    dir: SlideDir;
    ms: number;
  } | null>(null);
  const reviewSlideRef = useRef<ReviewSlide | null>(null);
  const prevFocusRef = useRef<number | null>(null);
  const slideTimerRef = useRef(0);
  const passFramesRef = useRef<ReviewSlide[] | null>(null);
  const [studioHero, setStudioHero] = useState(() => pickDetailsHero());
  const [scroll, setScroll] = useState({ progress: 0, thumb: 0.2 });
  const [pipAnims, setPipAnims] = useState<Map<number, PipAnim>>(() => new Map());
  const [flashingPips, setFlashingPips] = useState<Set<number>>(() => new Set());
  const [pipWaves, setPipWaves] = useState<
    Array<{ id: number; direction: "forward" | "reverse" }>
  >([]);
  const [loupe, setLoupe] = useState<LoupeView | null>(null);
  const loupeZoomRef = useRef(LOUPE_ZOOM_DEFAULT);
  const loupePointerRef = useRef<{ x: number; y: number } | null>(null);
  const loupeTouchActiveRef = useRef(false);
  const loupePinchRef = useRef<{ dist: number; zoom: number } | null>(null);
  const pipAnimsRef = useRef<Map<number, PipAnim>>(new Map());
  const dwellCompleteFiredRef = useRef<Set<number>>(new Set());
  const flashTimersRef = useRef<Map<number, number>>(new Map());
  const photoImgRef = useRef<HTMLImageElement>(null);
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
        sections[dwellIndex] &&
        isDwellPending(sections[dwellIndex])
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
        } else if (isDwellPending(s)) {
          const fromTone = dwellFrom(s);
          const toTone = dwellTarget(s);
          if (dwelling) {
            if (anim.to === toTone && anim.from === fromTone) {
              updated = {
                ...anim,
                progress: Math.min(1, anim.progress + (reduced ? 1 : dt / PIP_DWELL_MS))
              };
            } else {
              updated = { from: fromTone, to: toTone, progress: reduced ? 1 : 0 };
              if (anim.to === toTone && anim.progress > 0) {
                updated = { from: fromTone, to: toTone, progress: anim.progress };
              }
            }
            if (updated.progress >= 1 && !dwellCompleteFiredRef.current.has(num)) {
              dwellCompleteFiredRef.current.add(num);
              flashPip(num);
              const idx = sections.findIndex((x) => x.entry.number === num);
              if (idx >= 0) onDwellCompleteRef.current?.(idx);
            }
          } else if (anim.to === toTone && anim.from === fromTone && anim.progress > 0) {
            updated = {
              ...anim,
              progress: Math.max(0, anim.progress - (reduced ? 1 : dt / PIP_REVERSE_MS))
            };
            dwellCompleteFiredRef.current.delete(num);
          } else if (anim.to !== fromTone || anim.progress < 1) {
            updated = startTransition(anim, fromTone);
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
    const revoke = (slide: ReviewSlide | null | undefined) => {
      if (slide?.objectUrl) URL.revokeObjectURL(slide.src);
    };
    const clearPass = (keep?: ReviewSlide | null) => {
      const frames = passFramesRef.current;
      passFramesRef.current = null;
      if (frames) {
        for (const frame of frames) {
          if (keep && frame.src === keep.src) continue;
          revoke(frame);
        }
      }
      setReviewPass(null);
    };

    if (step !== "review") {
      if (slideTimerRef.current) {
        window.clearTimeout(slideTimerRef.current);
        slideTimerRef.current = 0;
      }
      clearPass();
      revoke(reviewSlideRef.current);
      reviewSlideRef.current = null;
      setReviewSlide(null);
      setReviewOutgoing((cur) => {
        revoke(cur?.slide);
        return null;
      });
      prevFocusRef.current = null;
      return;
    }

    let next: ReviewSlide | null = null;
    if (section?.entry.images.length) {
      next = {
        src: imagePreviewUrl(
          section.entry.images[0],
          section.entry.imageNames[0]
        ),
        objectUrl: true,
        sectionNum: section.entry.number
      };
    }

    const current = reviewSlideRef.current;
    const prevFocus = prevFocusRef.current;
    const nextFocus = focusedIndex;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    // Same focused photo — keep the existing object URL.
    if (
      current &&
      next &&
      current.sectionNum != null &&
      current.sectionNum === next.sectionNum
    ) {
      revoke(next);
      prevFocusRef.current = nextFocus;
      return;
    }

    const canSlide =
      !reduceMotion &&
      current != null &&
      next != null &&
      prevFocus != null &&
      nextFocus != null &&
      prevFocus !== nextFocus;

    if (slideTimerRef.current) {
      window.clearTimeout(slideTimerRef.current);
      slideTimerRef.current = 0;
    }

    if (
      canSlide &&
      current &&
      next &&
      prevFocus != null &&
      nextFocus != null
    ) {
      const dir: SlideDir = nextFocus > prevFocus ? "up" : "down";
      const span = Math.abs(nextFocus - prevFocus);

      if (studioPhotoPassThrough && span > 1) {
        const stepIdx = nextFocus > prevFocus ? 1 : -1;
        const travel: ReviewSlide[] = [current];
        for (let i = prevFocus + stepIdx; i !== nextFocus; i += stepIdx) {
          const s = sections[i];
          if (!s?.entry.images.length) continue;
          travel.push({
            src: imagePreviewUrl(s.entry.images[0], s.entry.imageNames[0]),
            objectUrl: true,
            sectionNum: s.entry.number
          });
        }
        travel.push(next);

        if (travel.length > 2) {
          clearPass();
          setReviewOutgoing((cur) => {
            revoke(cur?.slide);
            return null;
          });
          const ms = Math.min(
            PHOTO_PASS_MAX_MS,
            Math.max(PHOTO_SLIDE_MS, PHOTO_PASS_STEP_MS * (travel.length - 1))
          );
          passFramesRef.current = travel;
          setReviewPass({ frames: travel, dir, ms });
          reviewSlideRef.current = next;
          setReviewSlide(next);
          slideTimerRef.current = window.setTimeout(() => {
            clearPass(next);
            slideTimerRef.current = 0;
          }, ms);
          prevFocusRef.current = nextFocus;
          return;
        }

        for (const frame of travel) {
          if (frame !== current && frame !== next) revoke(frame);
        }
      }

      clearPass(current);
      setReviewOutgoing((cur) => {
        if (cur && cur.slide.src !== current.src) revoke(cur.slide);
        return { slide: current, dir };
      });
      reviewSlideRef.current = next;
      setReviewSlide(next);
      slideTimerRef.current = window.setTimeout(() => {
        setReviewOutgoing((cur) => {
          revoke(cur?.slide);
          return null;
        });
        slideTimerRef.current = 0;
      }, PHOTO_SLIDE_MS);
    } else {
      clearPass();
      setReviewOutgoing((cur) => {
        revoke(cur?.slide);
        return null;
      });
      if (current) revoke(current);
      reviewSlideRef.current = next;
      setReviewSlide(next);
    }

    prevFocusRef.current = nextFocus;
  }, [
    step,
    focusedIndex,
    studioPhotoPassThrough,
    sections,
    section?.entry.images,
    section?.entry.imageNames,
    section?.entry.number
  ]);

  useEffect(() => {
    return () => {
      if (slideTimerRef.current) window.clearTimeout(slideTimerRef.current);
      const cur = reviewSlideRef.current;
      if (cur?.objectUrl) URL.revokeObjectURL(cur.src);
      reviewSlideRef.current = null;
      const frames = passFramesRef.current;
      passFramesRef.current = null;
      if (frames) {
        for (const frame of frames) {
          if (cur && frame.src === cur.src) continue;
          if (frame.objectUrl) URL.revokeObjectURL(frame.src);
        }
      }
    };
  }, []);

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

  const focusedSection = section;
  const focusedErrored =
    focusedSection != null &&
    (aiErrorSectionNums?.has(focusedSection.entry.number) ?? false);
  const focusedAnim =
    focusedSection != null
      ? (pipAnims.get(focusedSection.entry.number) ?? {
          from: pipTone(focusedSection),
          to: pipTone(focusedSection),
          progress: 1
        })
      : null;
  const focusedFilling =
    focusedAnim != null && !focusedErrored && focusedAnim.progress < 1;
  const focusedFlashing =
    focusedSection != null &&
    !focusedErrored &&
    flashingPips.has(focusedSection.entry.number);
  const focusedTone: PipTone | "error" = focusedErrored
    ? "error"
    : focusedFilling && focusedAnim
      ? focusedAnim.from
      : focusedAnim
        ? focusedAnim.to
        : "empty";
  const focusedStripedFrom =
    focusedAnim != null &&
    (focusedAnim.from === "noteConfirm" || focusedAnim.from === "review");
  const focusedFillStyle =
    focusedFilling && focusedAnim
      ? ({
          ...(focusedStripedFrom
            ? {}
            : { ["--pip-from"]: PIP_COLORS[focusedAnim.from] }),
          ["--dwell-fill"]: focusedAnim.progress.toFixed(4),
          ["--pip-to"]: PIP_COLORS[focusedAnim.to]
        } as CSSProperties)
      : undefined;

  const reviewCaption =
    section?.headingLine?.trim() ||
    section?.entry.note?.trim() ||
    (section ? `Section ${section.entry.number}` : "No section");
  const useStudioHero = step === "details" || step === "generate";
  const photoSrc = useStudioHero ? studioHero : reviewSlide?.src ?? null;
  const heroCaption = step === "generate" ? "Generate report" : "Report details";
  const loupeEnabled = step === "review" && !showSectionText;

  const updateLoupe = (clientX: number, clientY: number, zoom = loupeZoomRef.current) => {
    if (!loupeEnabled) {
      setLoupe(null);
      return;
    }
    const img = photoImgRef.current;
    const photo = photoRef.current;
    const src = photoSrc;
    if (!img || !src || !img.naturalWidth) {
      setLoupe(null);
      return;
    }
    const shell = leftColumnShell();
    if (!shell) {
      setLoupe(null);
      return;
    }
    const { nx, ny, dispW, dispH, ox, oy, imgRect, inside } = coverFocus(
      img,
      clientX,
      clientY
    );
    if (!inside) {
      setLoupe(null);
      return;
    }
    loupePointerRef.current = { x: clientX, y: clientY };
    const pr = photo?.getBoundingClientRect();
    if (photo && pr) {
      photo.style.setProperty("--loupe-x", `${clientX - pr.left}px`);
      photo.style.setProperty("--loupe-y", `${clientY - pr.top}px`);
    }
    const imgW = dispW * zoom;
    const imgH = dispH * zoom;
    // Region of the source image currently filling the loupe panel.
    const viewW = shell.width / zoom;
    const viewH = shell.height / zoom;
    const outlineLeft =
      (pr ? imgRect.left - pr.left : 0) + ox + nx * dispW - viewW / 2;
    const outlineTop =
      (pr ? imgRect.top - pr.top : 0) + oy + ny * dispH - viewH / 2;
    setLoupe({
      src,
      imgW,
      imgH,
      left: shell.width / 2 - nx * imgW,
      top: shell.height / 2 - ny * imgH,
      shell,
      outline: {
        left: outlineLeft,
        top: outlineTop,
        width: viewW,
        height: viewH
      }
    });
  };

  const clearLoupe = () => {
    photoRef.current?.style.removeProperty("--loupe-x");
    photoRef.current?.style.removeProperty("--loupe-y");
    loupePointerRef.current = null;
    loupeZoomRef.current = LOUPE_ZOOM_DEFAULT;
    setLoupe(null);
  };

  useEffect(() => {
    setLoupe(null);
    loupePointerRef.current = null;
    loupeZoomRef.current = LOUPE_ZOOM_DEFAULT;
  }, [photoSrc, step]);

  // Non-passive so we can prevent the page from scrolling while zooming.
  useEffect(() => {
    if (!loupeEnabled) return;
    const photo = photoRef.current;
    if (!photo) return;
    const onWheel = (e: WheelEvent) => {
      if (!photoSrc) return;
      e.preventDefault();
      e.stopPropagation();
      const direction = e.deltaY > 0 ? -1 : e.deltaY < 0 ? 1 : 0;
      if (!direction) return;
      const next = Math.min(
        LOUPE_ZOOM_MAX,
        Math.max(
          LOUPE_ZOOM_MIN,
          loupeZoomRef.current + direction * LOUPE_ZOOM_STEP
        )
      );
      if (next === loupeZoomRef.current) return;
      loupeZoomRef.current = next;
      const ptr = loupePointerRef.current;
      if (ptr) updateLoupe(ptr.x, ptr.y, next);
      else updateLoupe(e.clientX, e.clientY, next);
    };

    // Touch: one finger pans the loupe; two-finger pinch changes zoom.
    const pinchDist = (t: TouchList) =>
      Math.hypot(
        t[0].clientX - t[1].clientX,
        t[0].clientY - t[1].clientY
      );
    const pinchMid = (t: TouchList) => ({
      x: (t[0].clientX + t[1].clientX) / 2,
      y: (t[0].clientY + t[1].clientY) / 2
    });

    const onTouchStart = (e: TouchEvent) => {
      if (!photoSrc) return;
      if (e.touches.length === 2) {
        e.preventDefault();
        loupePinchRef.current = {
          dist: pinchDist(e.touches),
          zoom: loupeZoomRef.current
        };
        const mid = pinchMid(e.touches);
        updateLoupe(mid.x, mid.y);
      } else if (e.touches.length === 1) {
        loupeTouchActiveRef.current = true;
        loupePinchRef.current = null;
        updateLoupe(e.touches[0].clientX, e.touches[0].clientY);
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!photoSrc) return;
      if (e.touches.length === 2) {
        e.preventDefault();
        const dist = pinchDist(e.touches);
        const pinch = loupePinchRef.current;
        if (pinch && pinch.dist > 0) {
          const next = Math.min(
            LOUPE_ZOOM_MAX,
            Math.max(LOUPE_ZOOM_MIN, pinch.zoom * (dist / pinch.dist))
          );
          loupeZoomRef.current = next;
          const mid = pinchMid(e.touches);
          updateLoupe(mid.x, mid.y, next);
        } else {
          loupePinchRef.current = {
            dist,
            zoom: loupeZoomRef.current
          };
        }
      } else if (e.touches.length === 1 && loupeTouchActiveRef.current) {
        e.preventDefault();
        updateLoupe(e.touches[0].clientX, e.touches[0].clientY);
      }
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) loupePinchRef.current = null;
      if (e.touches.length === 0) {
        loupeTouchActiveRef.current = false;
        clearLoupe();
      } else if (e.touches.length === 1) {
        loupeTouchActiveRef.current = true;
        updateLoupe(e.touches[0].clientX, e.touches[0].clientY);
      }
    };

    photo.addEventListener("wheel", onWheel, { passive: false });
    photo.addEventListener("touchstart", onTouchStart, { passive: false });
    photo.addEventListener("touchmove", onTouchMove, { passive: false });
    photo.addEventListener("touchend", onTouchEnd);
    photo.addEventListener("touchcancel", onTouchEnd);
    return () => {
      photo.removeEventListener("wheel", onWheel);
      photo.removeEventListener("touchstart", onTouchStart);
      photo.removeEventListener("touchmove", onTouchMove);
      photo.removeEventListener("touchend", onTouchEnd);
      photo.removeEventListener("touchcancel", onTouchEnd);
    };
    // updateLoupe / clearLoupe close over latest photoSrc / layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loupeEnabled, photoSrc, step]);

  return (
    <>
    {createPortal(
    <aside className="studio-aside" aria-label="Studio preview">
      <div
        ref={photoRef}
        className={`studio-aside-photo${useStudioHero ? " is-details" : ""}${loupe ? " is-loupe-source" : ""}${loupeEnabled ? " is-loupe-ready" : ""}`}
        onPointerMove={
          loupeEnabled
            ? (e) => {
                // Touch loupe is handled via non-passive touch listeners above.
                if (e.pointerType === "touch") return;
                updateLoupe(e.clientX, e.clientY);
              }
            : undefined
        }
        onPointerLeave={
          loupeEnabled
            ? () => {
                if (loupeTouchActiveRef.current) return;
                clearLoupe();
              }
            : undefined
        }
        onPointerCancel={
          loupeEnabled
            ? () => {
                loupeTouchActiveRef.current = false;
                clearLoupe();
              }
            : undefined
        }
      >
        {showSectionText && step === "review" ? (
          <div className="studio-aside-section-text">
            <p>
              {section?.text.trim() ||
                section?.entry.note.trim() ||
                t("studio.emptyText")}
            </p>
          </div>
        ) : useStudioHero ? (
          <img
            ref={photoImgRef}
            key={studioHero}
            src={studioHero}
            alt="Stack of survey reports"
            draggable={false}
          />
        ) : (
          <div className="studio-aside-photo-stage">
            {reviewPass ? (
              <div
                className="studio-aside-photo-flipbook"
                style={
                  {
                    ["--flip-count"]: reviewPass.frames.length,
                    ["--flip-ms"]: `${reviewPass.ms}ms`,
                    ["--flip-from"]:
                      reviewPass.dir === "up"
                        ? "0%"
                        : `calc((1 - var(--flip-count)) / var(--flip-count) * 100%)`,
                    ["--flip-to"]:
                      reviewPass.dir === "up"
                        ? `calc((1 - var(--flip-count)) / var(--flip-count) * 100%)`
                        : "0%"
                  } as CSSProperties
                }
              >
                {(reviewPass.dir === "up"
                  ? reviewPass.frames
                  : [...reviewPass.frames].reverse()
                ).map((frame, i) => (
                  <img
                    key={`${frame.sectionNum ?? "x"}-${i}`}
                    className="studio-aside-photo-flip-frame"
                    src={frame.src}
                    alt=""
                    draggable={false}
                    aria-hidden
                  />
                ))}
              </div>
            ) : (
              <>
                {reviewOutgoing && (
                  <img
                    className={`studio-aside-photo-slide is-exit-${reviewOutgoing.dir}`}
                    src={reviewOutgoing.slide.src}
                    alt=""
                    draggable={false}
                    aria-hidden
                  />
                )}
                {reviewSlide ? (
                  <img
                    ref={photoImgRef}
                    key={reviewSlide.src}
                    className={`studio-aside-photo-slide${
                      reviewOutgoing ? ` is-enter-${reviewOutgoing.dir}` : ""
                    }`}
                    src={reviewSlide.src}
                    alt=""
                    draggable={false}
                  />
                ) : (
                  !reviewOutgoing && (
                    <div className="studio-aside-empty">
                      <span>No photo</span>
                      <small>Focus a section to preview it here</small>
                    </div>
                  )
                )}
              </>
            )}
          </div>
        )}
        {loupe && (
          <div
            className="studio-loupe-outline"
            aria-hidden
            style={{
              left: loupe.outline.left,
              top: loupe.outline.top,
              width: loupe.outline.width,
              height: loupe.outline.height
            }}
          />
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
            // Striped bases keep their CSS gradient (not a solid fill colour).
            const stripedFrom =
              anim.from === "noteConfirm" || anim.from === "review";
            const fillStyle = filling
              ? ({
                  ...(stripedFrom
                    ? {}
                    : { ["--pip-from"]: PIP_COLORS[anim.from] }),
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
                    : s.pendingNoteConfirm
                      ? `Section ${s.entry.number} — confirm field note`
                      : s.pendingReview
                        ? `Section ${s.entry.number} — review wording`
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
                  const card = document.getElementById(
                    `section-card-${s.entry.number}`
                  );
                  if (card) scrollElementIntoViewCentered(card);
                }}
                onMouseEnter={() => {
                  if (!pipJumpOnHover || step !== "review") return;
                  onJumpSection?.(i);
                  const card = document.getElementById(
                    `section-card-${s.entry.number}`
                  );
                  if (card) scrollElementIntoViewCentered(card);
                }}
              >
                {/* Face carries colour — not the <button> — so UA dark mode can't remap it. */}
                <span className="studio-pip-face" aria-hidden />
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
            className={`studio-scroll-thumb tone-${focusedTone}${focusedFilling ? " is-filling" : ""}${focusedFlashing ? " is-flash" : ""}`}
            style={{
              top: `${thumbTop}%`,
              height: `${thumbHeight}%`,
              ...focusedFillStyle
            }}
            aria-label="Drag to scroll"
            onPointerDown={onThumbPointerDown}
            onPointerMove={onThumbPointerMove}
            onPointerUp={onThumbPointerUp}
            onPointerCancel={onThumbPointerUp}
          >
            <span className="studio-scroll-thumb-face" aria-hidden />
          </button>
        </div>
      </div>
    </aside>,
    document.body
    )}
    {loupe &&
      createPortal(
        <div
          className="studio-loupe"
          aria-hidden
          style={{
            left: loupe.shell.left,
            top: loupe.shell.top,
            width: loupe.shell.width,
            height: loupe.shell.height
          }}
        >
          <div className="studio-loupe-frame">
            <img
              src={loupe.src}
              alt=""
              draggable={false}
              style={{
                width: loupe.imgW,
                height: loupe.imgH,
                transform: `translate(${loupe.left}px, ${loupe.top}px)`
              }}
            />
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
