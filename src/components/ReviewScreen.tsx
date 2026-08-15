import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from "react";
import { createPortal } from "react-dom";
import EntryCard from "./EntryCard";
import AnnotationOverlay from "./AnnotationOverlay";
import { getImageDims } from "../lib/imageUtils";
import { rotate, spinFromDelta, stepUpright, unrotate } from "../lib/dragSpin";
import {
  applyLiftScrollLock,
  autoScrollForLift,
  clearLiftScrollLock,
  clampLiftScroll,
  insertSlotFromPointerY,
  isLiftInteractiveTarget,
  recoverScrollTouchAfterLift,
  reorderArray,
  SECTION_LIFT_HOLD_MS,
  SECTION_LIFT_MOVE_SLOP_PX,
  slotToRemovalIndex
} from "../lib/sectionLift";
import { getScrollRoot, isProgrammaticScroll, readScrollTop } from "../lib/scrollRoot";
import type { PhotoAnnotation, PhotoCrop, SectionState } from "../types";

interface Props {
  sections: SectionState[];
  warnings: string[];
  flaggedCount: number;
  aiConfigured: boolean;
  busy: boolean;
  busySectionIndex: number | null;
  aiErrors: Record<number, string>;
  onChange: (index: number, next: SectionState) => void;
  onAskAi: (index: number) => void;
  onAskAiAll: () => void;
  onStopAiBatch: () => void;
  aiBatchRunning: boolean;
  onDismissAiError: (index: number) => void;
  onContinue: () => void;
  onAddMoreNotes: () => void;
  onDeleteSection: (index: number) => void;
  onAnnotateSection: (
    index: number,
    annotations: PhotoAnnotation[],
    crop?: PhotoCrop
  ) => void | Promise<void>;
  /** Prefer raw field-note bytes when annotating (avoids double-burning). */
  annotateBaseImage?: (index: number) => Uint8Array | null;
  onFocusSection: (index: number) => void;
  focusedSectionIndex: number | null;
  /** Section index currently running the review dwell fill, if any. */
  dwellSectionIndex: number | null;
  onReorderSections: (from: number, to: number) => void;
  tutorial?: boolean;
  tutorialAskAiIndex?: number | null;
  lockContinue?: boolean;
  lockReorder?: boolean;
}

/** React-facing drag snapshot (drop index + ghost identity). */
type LiftDrag = {
  from: number;
  entryNumber: number;
  pointerId: number;
  width: number;
  /** Destination index after removal (0…n-1). */
  to: number;
};

/** Imperative spin / pose — updated every pointer/scroll/raf tick. */
type LiftPhysics = {
  pointerId: number;
  from: number;
  width: number;
  scale: number;
  scaleFrom: number;
  scaleTo: number;
  scaleStart: number;
  releasing: boolean;
  /** Grab in full-size card layout space, origin at center. */
  grabLocalX: number;
  grabLocalY: number;
  pointerX: number;
  pointerY: number;
  lastX: number;
  lastY: number;
  lastScrollTop: number;
  rot: number;
  vr: number;
  to: number;
  pointerType: string;
  /** True after Firefox cancels the pointer mid auto-scroll — keep dragging via touch events. */
  useTouchFallback: boolean;
  /** Free-pose release tween (center + shortest-path rotation). */
  releaseCxFrom: number;
  releaseCyFrom: number;
  releaseCxTo: number;
  releaseCyTo: number;
  releaseRotFrom: number;
  releaseRotDelta: number;
  poseCx: number;
  poseCy: number;
};

type HoldArm = {
  index: number;
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  startedAt: number;
};

const LIFT_SCALE = 0.5;
const LIFT_SCALE_MS = 260;
const LIFT_RELEASE_MS = 340;

function easeOutCubic(t: number) {
  const u = Math.min(1, Math.max(0, t));
  return 1 - (1 - u) ** 3;
}

/** Shortest signed delta from `fromDeg` to `toDeg` in (-180, 180]. */
function shortestRotDelta(fromDeg: number, toDeg: number) {
  let d = toDeg - fromDeg;
  while (d > 180) d -= 360;
  while (d <= -180) d += 360;
  return d;
}

export default function ReviewScreen({
  sections,
  warnings,
  flaggedCount,
  aiConfigured,
  busy,
  busySectionIndex,
  aiErrors,
  onChange,
  onAskAi,
  onAskAiAll,
  onStopAiBatch,
  aiBatchRunning,
  onDismissAiError,
  onContinue,
  onAddMoreNotes,
  onDeleteSection,
  onAnnotateSection,
  annotateBaseImage,
  onFocusSection,
  focusedSectionIndex,
  dwellSectionIndex,
  onReorderSections,
  tutorial = false,
  tutorialAskAiIndex = null,
  lockContinue = false,
  lockReorder = false
}: Props) {
  const [showWarnings, setShowWarnings] = useState(false);
  const [holdArm, setHoldArm] = useState<HoldArm | null>(null);
  const [holdProgress, setHoldProgress] = useState(0);
  const [drag, setDrag] = useState<LiftDrag | null>(null);
  const [annotate, setAnnotate] = useState<{
    index: number;
    url: string;
    width: number;
    height: number;
    initial: PhotoAnnotation[];
    initialCrop?: PhotoCrop;
  } | null>(null);
  const holdTimerRef = useRef(0);
  const holdRafRef = useRef(0);
  const dragRef = useRef<LiftDrag | null>(null);
  const physicsRef = useRef<LiftPhysics | null>(null);
  const ghostElRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const autoScrollRafRef = useRef(0);
  const physicsRafRef = useRef(0);
  const autoScrollActiveRef = useRef(false);
  const lockedScrollTopRef = useRef(0);

  dragRef.current = drag;

  const sectionNumbers = useMemo(
    () => sections.map((s) => s.entry.number),
    [sections]
  );

  const closeAnnotate = useCallback(() => {
    setAnnotate((cur) => {
      if (cur?.url) URL.revokeObjectURL(cur.url);
      return null;
    });
  }, []);

  const openAnnotate = useCallback(
    (index: number) => {
      const section = sections[index];
      if (!section) return;
      const raw = annotateBaseImage?.(index) ?? null;
      const base = raw ?? section.entry.images[0] ?? null;
      if (!base || base.length === 0) return;
      const dims = getImageDims(base) ?? { width: 1600, height: 1200 };
      const copy = new Uint8Array(base.byteLength);
      copy.set(base);
      const url = URL.createObjectURL(
        new Blob([copy], { type: "image/jpeg" })
      );
      setAnnotate((cur) => {
        if (cur?.url) URL.revokeObjectURL(cur.url);
        return {
          index,
          url,
          width: dims.width,
          height: dims.height,
          // Only reload vectors when editing the unburned field-note original.
          initial: raw ? section.entry.annotations ?? [] : [],
          initialCrop: section.entry.photoCrop
        };
      });
    },
    [annotateBaseImage, sections]
  );

  const finishAnnotate = useCallback(
    (annotations: PhotoAnnotation[], crop?: PhotoCrop) => {
      if (!annotate) return;
      const index = annotate.index;
      closeAnnotate();
      void onAnnotateSection(index, annotations, crop);
    },
    [annotate, closeAnnotate, onAnnotateSection]
  );

  useEffect(() => () => {
    if (annotate?.url) URL.revokeObjectURL(annotate.url);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- revoke only on unmount
  }, []);

  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = 0;
    }
    if (holdRafRef.current) {
      window.cancelAnimationFrame(holdRafRef.current);
      holdRafRef.current = 0;
    }
  }, []);

  const cancelHold = useCallback(() => {
    clearHoldTimer();
    setHoldArm(null);
    setHoldProgress(0);
    if (!dragRef.current) {
      clearLiftScrollLock();
      recoverScrollTouchAfterLift();
    }
  }, [clearHoldTimer]);

  const measureOtherMids = useCallback((from: number) => {
    const mids: number[] = [];
    for (let i = 0; i < sections.length; i++) {
      if (i === from) continue;
      const el = cardRefs.current.get(i);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      mids.push(r.top + r.height / 2);
    }
    return mids;
  }, [sections.length]);

  const applyGhostPose = useCallback(() => {
    const p = physicsRef.current;
    const el = ghostElRef.current;
    if (!p || !el) return;
    let cx: number;
    let cy: number;
    if (p.releasing) {
      cx = p.poseCx;
      cy = p.poseCy;
    } else {
      const arm = rotate(p.grabLocalX * p.scale, p.grabLocalY * p.scale, p.rot);
      cx = p.pointerX - arm.x;
      cy = p.pointerY - arm.y;
    }
    // Fade toward 75% opacity as the card shrinks to lift size.
    const shrink =
      LIFT_SCALE >= 1
        ? 1
        : Math.min(1, Math.max(0, (1 - p.scale) / (1 - LIFT_SCALE)));
    const opacity = 1 - shrink * 0.25;
    el.style.left = `${cx}px`;
    el.style.top = `${cy}px`;
    el.style.width = `${p.width}px`;
    el.style.opacity = String(opacity);
    el.style.transform = `translate(-50%, -50%) scale(${p.scale}) rotate(${p.rot}deg)`;
  }, []);

  const measureReleaseTarget = useCallback(
    (from: number, to: number, width: number) => {
      const source = cardRefs.current.get(from);
      const sourceRect = source?.getBoundingClientRect();
      const cx =
        sourceRect != null
          ? sourceRect.left + sourceRect.width / 2
          : width / 2;
      const slotH = sourceRect?.height ?? 120;
      // Visual insert marker in the still-unmoved list.
      const before = to <= from ? to : to + 1;

      if (before === from && sourceRect) {
        return {
          cx: sourceRect.left + sourceRect.width / 2,
          cy: sourceRect.top + sourceRect.height / 2
        };
      }

      if (before >= sections.length) {
        let anchor: DOMRect | null = null;
        for (let i = sections.length - 1; i >= 0; i--) {
          if (i === from) continue;
          const el = cardRefs.current.get(i);
          if (el) {
            anchor = el.getBoundingClientRect();
            break;
          }
        }
        if (!anchor && sourceRect) anchor = sourceRect;
        if (anchor) {
          return { cx, cy: anchor.bottom + slotH / 2 + 6 };
        }
        return { cx, cy: window.innerHeight / 2 };
      }

      const ahead = cardRefs.current.get(before);
      const aheadRect = ahead?.getBoundingClientRect();
      if (aheadRect) {
        return { cx, cy: aheadRect.top - 6 + slotH / 2 };
      }
      if (sourceRect) {
        return {
          cx: sourceRect.left + sourceRect.width / 2,
          cy: sourceRect.top + sourceRect.height / 2
        };
      }
      return { cx, cy: window.innerHeight / 2 };
    },
    [sections.length]
  );

  /** Apply a screen-space delta as grab torque (pointer move or scroll-relative). */
  const applyRelativeDelta = useCallback(
    (pvx: number, pvy: number) => {
      const p = physicsRef.current;
      if (!p) return;
      const dRot = spinFromDelta(
        p.grabLocalX * p.scale,
        p.grabLocalY * p.scale,
        p.rot,
        pvx,
        pvy
      );
      p.rot += dRot;
      p.vr = dRot;
      applyGhostPose();
    },
    [applyGhostPose]
  );

  const syncDropIndex = useCallback(() => {
    const p = physicsRef.current;
    const d = dragRef.current;
    if (!p || !d) return;
    const slot = insertSlotFromPointerY(p.pointerY, measureOtherMids(p.from));
    const to = slotToRemovalIndex(p.from, slot);
    if (to === p.to && to === d.to) return;
    p.to = to;
    setDrag({ ...d, to });
  }, [measureOtherMids]);

  const beginDrag = useCallback(
    (arm: HoldArm, cardEl: HTMLDivElement) => {
      clearHoldTimer();
      setHoldArm(null);
      setHoldProgress(0);
      const r = cardEl.getBoundingClientRect();
      const cx = (r.left + r.right) / 2;
      const cy = (r.top + r.bottom) / 2;
      const local = unrotate(arm.startX - cx, arm.startY - cy, 0);
      const slot = insertSlotFromPointerY(
        arm.startY,
        measureOtherMids(arm.index)
      );
      const to = slotToRemovalIndex(arm.index, slot);
      const scrollTop = readScrollTop(getScrollRoot());
      lockedScrollTopRef.current = scrollTop;

      physicsRef.current = {
        pointerId: arm.pointerId,
        from: arm.index,
        width: r.width,
        scale: 1,
        scaleFrom: 1,
        scaleTo: LIFT_SCALE,
        scaleStart: performance.now(),
        releasing: false,
        grabLocalX: local.x,
        grabLocalY: local.y,
        pointerX: arm.startX,
        pointerY: arm.startY,
        lastX: arm.startX,
        lastY: arm.startY,
        lastScrollTop: scrollTop,
        rot: 0,
        vr: 0,
        to,
        pointerType: arm.pointerType,
        useTouchFallback: arm.pointerType === "touch",
        releaseCxFrom: 0,
        releaseCyFrom: 0,
        releaseCxTo: 0,
        releaseCyTo: 0,
        releaseRotFrom: 0,
        releaseRotDelta: 0,
        poseCx: 0,
        poseCy: 0
      };

      setDrag({
        from: arm.index,
        entryNumber: sections[arm.index]?.entry.number ?? 0,
        pointerId: arm.pointerId,
        width: r.width,
        to
      });
      onFocusSection(arm.index);
      try {
        cardEl.setPointerCapture(arm.pointerId);
      } catch {
        /* ignore */
      }
      // Pose after portal mounts
      requestAnimationFrame(() => applyGhostPose());
    },
    [
      applyGhostPose,
      clearHoldTimer,
      measureOtherMids,
      onFocusSection,
      sections
    ]
  );

  const commitDrag = useCallback(() => {
    const d = dragRef.current;
    const p = physicsRef.current;
    if (!d) return;
    const from = d.from;
    const to = p?.to ?? d.to;
    physicsRef.current = null;
    setDrag(null);
    recoverScrollTouchAfterLift();
    const list = sections;
    const preview = reorderArray(list, from, to);
    const same =
      preview.length === list.length &&
      preview.every((s, i) => s.entry.number === list[i]?.entry.number);
    if (!same) onReorderSections(from, to);
  }, [onReorderSections, sections]);

  const endDrag = useCallback(
    (pointerId: number) => {
      const d = dragRef.current;
      const p = physicsRef.current;
      if (!d || d.pointerId !== pointerId || !p) return;
      if (p.releasing) return;

      const arm = rotate(p.grabLocalX * p.scale, p.grabLocalY * p.scale, p.rot);
      const cx = p.pointerX - arm.x;
      const cy = p.pointerY - arm.y;
      const target = measureReleaseTarget(p.from, p.to, p.width);
      const rotDelta = shortestRotDelta(p.rot, 0);

      p.releasing = true;
      p.vr = 0;
      p.scaleFrom = p.scale;
      p.scaleTo = 1;
      p.scaleStart = performance.now();
      p.releaseCxFrom = cx;
      p.releaseCyFrom = cy;
      p.releaseCxTo = target.cx;
      p.releaseCyTo = target.cy;
      p.releaseRotFrom = p.rot;
      p.releaseRotDelta = rotDelta;
      p.poseCx = cx;
      p.poseCy = cy;
      applyGhostPose();
    },
    [applyGhostPose, measureReleaseTarget]
  );

  // Pointer / touch tracking + scroll-relative spin while dragging.
  useEffect(() => {
    if (!drag) return;

    const moveFromClient = (clientX: number, clientY: number) => {
      const p = physicsRef.current;
      if (!p || p.releasing) return;
      const pvx = clientX - p.lastX;
      const pvy = clientY - p.lastY;
      p.lastX = clientX;
      p.lastY = clientY;
      p.pointerX = clientX;
      p.pointerY = clientY;
      applyRelativeDelta(pvx, pvy);
      syncDropIndex();
    };

    const onPointerMove = (e: PointerEvent) => {
      const p = physicsRef.current;
      if (!p || p.pointerId !== e.pointerId || p.releasing) return;
      // Avoid preventDefault on touch — with scrollTop auto-scroll it breaks
      // Firefox's touch pan/zoom until the scrollport is remounted.
      if (e.pointerType !== "touch") e.preventDefault();
      moveFromClient(e.clientX, e.clientY);
    };

    const onPointerUp = (e: PointerEvent) => {
      endDrag(e.pointerId);
    };

    const onPointerCancel = (e: PointerEvent) => {
      const p = physicsRef.current;
      if (!p || p.pointerId !== e.pointerId) return;
      // Firefox cancels the pointer when programmatic scroll runs under a touch.
      // Keep the lift alive and continue via touch events.
      if (p.pointerType === "touch" && (isProgrammaticScroll() || autoScrollActiveRef.current)) {
        p.useTouchFallback = true;
        return;
      }
      endDrag(e.pointerId);
    };

    const touchOf = (e: TouchEvent) => {
      const p = physicsRef.current;
      if (!p) return null;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches.item(i);
        if (t && t.identifier === p.pointerId) return t;
      }
      for (let i = 0; i < e.touches.length; i++) {
        const t = e.touches.item(i);
        if (t && t.identifier === p.pointerId) return t;
      }
      return null;
    };

    const onTouchMove = (e: TouchEvent) => {
      const p = physicsRef.current;
      if (!p || p.releasing || p.pointerType !== "touch") return;
      const t = touchOf(e);
      if (!t) return;
      // Passive: do not preventDefault (Firefox APZ).
      moveFromClient(t.clientX, t.clientY);
    };

    const onTouchEnd = (e: TouchEvent) => {
      const p = physicsRef.current;
      if (!p || p.pointerType !== "touch") return;
      const t = touchOf(e);
      if (!t) return;
      endDrag(p.pointerId);
    };

    const onTouchCancel = (e: TouchEvent) => {
      const p = physicsRef.current;
      if (!p || p.pointerType !== "touch") return;
      const t = touchOf(e);
      if (!t) return;
      if (isProgrammaticScroll() || autoScrollActiveRef.current) {
        p.useTouchFallback = true;
        return;
      }
      endDrag(p.pointerId);
    };

    const onScroll = () => {
      const p = physicsRef.current;
      if (!p || p.releasing) return;
      const root = getScrollRoot();
      const scrollTop = readScrollTop(root);
      const ds = scrollTop - p.lastScrollTop;
      if (ds === 0) return;
      // Only edge auto-scroll should move the list. Resync baseline without
      // writing scrollTop (Firefox touch + scroll writes during a gesture breaks APZ).
      if (!isProgrammaticScroll() && !autoScrollActiveRef.current) {
        p.lastScrollTop = scrollTop;
        return;
      }
      p.lastScrollTop = scrollTop;
      applyRelativeDelta(0, ds);
      syncDropIndex();
    };

    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("touchmove", onTouchMove, { passive: true, capture: true });
    window.addEventListener("touchend", onTouchEnd, { capture: true });
    window.addEventListener("touchcancel", onTouchCancel, { capture: true });
    window.addEventListener("scroll", onScroll, true);
    const root = getScrollRoot();
    if (root instanceof HTMLElement) {
      root.addEventListener("scroll", onScroll, { passive: true });
    }
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("touchmove", onTouchMove, true);
      window.removeEventListener("touchend", onTouchEnd, true);
      window.removeEventListener("touchcancel", onTouchCancel, true);
      window.removeEventListener("scroll", onScroll, true);
      if (root instanceof HTMLElement) {
        root.removeEventListener("scroll", onScroll);
      }
    };
  }, [applyRelativeDelta, drag, endDrag, syncDropIndex]);

  // Scale in/out + upright spring; release also corrects orientation into place.
  useEffect(() => {
    if (!drag) {
      if (physicsRafRef.current) {
        window.cancelAnimationFrame(physicsRafRef.current);
        physicsRafRef.current = 0;
      }
      return;
    }
    let last = performance.now();
    const tick = (now: number) => {
      const p = physicsRef.current;
      if (!p) return;
      const dt = Math.min(32, now - last) / 16.67;
      last = now;

      if (p.releasing) {
        // Longer settle when the card is more tilted at release.
        const tiltMs = Math.min(220, Math.abs(p.releaseRotDelta) * 2.2);
        const duration = LIFT_RELEASE_MS + tiltMs;
        const t = easeOutCubic((now - p.scaleStart) / duration);
        p.scale = p.scaleFrom + (p.scaleTo - p.scaleFrom) * t;
        p.rot = p.releaseRotFrom + p.releaseRotDelta * t;
        p.poseCx = p.releaseCxFrom + (p.releaseCxTo - p.releaseCxFrom) * t;
        p.poseCy = p.releaseCyFrom + (p.releaseCyTo - p.releaseCyFrom) * t;
        p.vr = 0;
        applyGhostPose();
        if (t >= 1) {
          commitDrag();
          return;
        }
      } else {
        const scaleT = easeOutCubic((now - p.scaleStart) / LIFT_SCALE_MS);
        p.scale = p.scaleFrom + (p.scaleTo - p.scaleFrom) * scaleT;
        const next = stepUpright(p.rot, p.vr, dt, 0);
        p.rot = next.rot;
        p.vr = next.vr;
        applyGhostPose();
      }

      physicsRafRef.current = window.requestAnimationFrame(tick);
    };
    physicsRafRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (physicsRafRef.current) {
        window.cancelAnimationFrame(physicsRafRef.current);
        physicsRafRef.current = 0;
      }
    };
  }, [applyGhostPose, commitDrag, drag]);

  const onWrapPointerDown = (
    e: ReactPointerEvent<HTMLDivElement>,
    index: number
  ) => {
    if (lockReorder) return;
    if (busy || aiBatchRunning || drag) return;
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if (isLiftInteractiveTarget(e.target)) return;

    cancelHold();
    // Lock before the next touchmove — CSS mid-gesture is too late on Firefox.
    lockedScrollTopRef.current = readScrollTop(getScrollRoot());
    applyLiftScrollLock();

    const arm: HoldArm = {
      index,
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      startX: e.clientX,
      startY: e.clientY,
      startedAt: performance.now()
    };
    setHoldArm(arm);
    setHoldProgress(0);

    const tick = () => {
      const elapsed = performance.now() - arm.startedAt;
      setHoldProgress(Math.min(1, elapsed / SECTION_LIFT_HOLD_MS));
      // Pin scroll during the hold so a finger drift cannot pan the page.
      lockedScrollTopRef.current = clampLiftScroll(lockedScrollTopRef.current);
      if (elapsed < SECTION_LIFT_HOLD_MS) {
        holdRafRef.current = window.requestAnimationFrame(tick);
      }
    };
    holdRafRef.current = window.requestAnimationFrame(tick);

    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = 0;
      const cardEl = cardRefs.current.get(index);
      if (!cardEl) {
        cancelHold();
        return;
      }
      beginDrag(arm, cardEl);
    }, SECTION_LIFT_HOLD_MS);
  };

  const onWrapPointerMove = (
    e: ReactPointerEvent<HTMLDivElement>,
    index: number
  ) => {
    if (holdArm && holdArm.pointerId === e.pointerId && holdArm.index === index) {
      const dx = e.clientX - holdArm.startX;
      const dy = e.clientY - holdArm.startY;
      if (Math.hypot(dx, dy) > SECTION_LIFT_MOVE_SLOP_PX) {
        cancelHold();
      }
    }
  };

  const onWrapPointerUp = (
    e: ReactPointerEvent<HTMLDivElement>,
    index: number
  ) => {
    if (holdArm?.pointerId === e.pointerId) cancelHold();
    const el = cardRefs.current.get(index);
    try {
      el?.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  // Edge auto-scroll while dragging
  useEffect(() => {
    if (!drag) {
      if (autoScrollRafRef.current) {
        window.cancelAnimationFrame(autoScrollRafRef.current);
        autoScrollRafRef.current = 0;
      }
      return;
    }
    const tick = () => {
      const p = physicsRef.current;
      if (!p || p.releasing) {
        autoScrollActiveRef.current = false;
        lockedScrollTopRef.current = clampLiftScroll(lockedScrollTopRef.current);
        autoScrollRafRef.current = window.requestAnimationFrame(tick);
        return;
      }
      const scrolled = autoScrollForLift(p.pointerY);
      autoScrollActiveRef.current = scrolled;
      if (scrolled) {
        const scrollTop = readScrollTop(getScrollRoot());
        const ds = scrollTop - p.lastScrollTop;
        p.lastScrollTop = scrollTop;
        lockedScrollTopRef.current = scrollTop;
        if (ds !== 0) applyRelativeDelta(0, ds);
        syncDropIndex();
      } else {
        // Finger pans must not move the list — only edge auto-scroll may.
        lockedScrollTopRef.current = clampLiftScroll(lockedScrollTopRef.current);
        p.lastScrollTop = lockedScrollTopRef.current;
      }
      autoScrollRafRef.current = window.requestAnimationFrame(tick);
    };
    autoScrollRafRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (autoScrollRafRef.current) {
        window.cancelAnimationFrame(autoScrollRafRef.current);
        autoScrollRafRef.current = 0;
      }
    };
  }, [applyRelativeDelta, drag, syncDropIndex]);

  // Keep CSS lock in sync with hold/drag; helpers own apply/clear for Firefox timing.
  useEffect(() => {
    if (!holdArm && !drag) return;
    applyLiftScrollLock();

    const blockWheel = (e: WheelEvent) => {
      e.preventDefault();
    };
    window.addEventListener("wheel", blockWheel, { passive: false, capture: true });

    return () => {
      window.removeEventListener("wheel", blockWheel, true);
    };
  }, [holdArm, drag]);

  useEffect(() => {
    if (drag || holdArm) return;
    clearLiftScrollLock();
    recoverScrollTouchAfterLift();
  }, [drag, holdArm]);

  useEffect(() => () => cancelHold(), [cancelHold]);

  // Drop line: show before the card at visual position
  const dropBeforeIndex = useMemo(() => {
    if (!drag) return null;
    const { from, to } = drag;
    if (to <= from) return to;
    return to + 1;
  }, [drag]);

  const ghostSection = drag ? sections[drag.from] : null;

  return (
    <div className={`review${drag ? " is-reordering" : ""}`}>
      <div className="review-summary">
        <p>
          <strong>{sections.length}</strong> photo sections found
          {flaggedCount > 0 ? (
            <>
              , <strong>{flaggedCount}</strong> need attention
            </>
          ) : (
            " - all matched"
          )}
          .
        </p>
        <p className="muted review-reorder-hint">
          Press and hold a section for 2 seconds, then drag to reorder.
        </p>
        {flaggedCount > 0 && !tutorial && (
          aiBatchRunning ? (
            <button type="button" className="btn danger" onClick={onStopAiBatch}>
              Stop AI
            </button>
          ) : (
            <button
              className="btn primary"
              disabled={busy || !aiConfigured}
              title={aiConfigured ? "" : "Add your API key in Settings"}
              onClick={onAskAiAll}
            >
              Ask AI about all flagged ({flaggedCount})
            </button>
          )
        )}
        {warnings.length > 0 && (
          <button className="btn small" onClick={() => setShowWarnings(!showWarnings)}>
            {showWarnings ? "Hide" : "Show"} {warnings.length} parsing warning(s)
          </button>
        )}
        {showWarnings && (
          <ul className="warnings">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
      </div>

      {sections.map((s, i) => {
        const arming = holdArm?.index === i;
        const dragging = drag?.from === i;
        const showDropBefore = dropBeforeIndex === i;
        return (
          <div key={s.entry.number} className="section-ord-slot">
            {showDropBefore && <div className="section-drop-line" aria-hidden />}
            <div
              ref={(el) => {
                if (el) cardRefs.current.set(i, el);
                else cardRefs.current.delete(i);
              }}
              className={`section-ord-wrap${arming ? " is-lift-arming" : ""}${dragging ? " is-lift-source" : ""}`}
              style={
                arming
                  ? ({ ["--lift-hold"]: String(holdProgress) } as CSSProperties)
                  : undefined
              }
              onPointerDownCapture={(e) => onWrapPointerDown(e, i)}
              onPointerMove={(e) => onWrapPointerMove(e, i)}
              onPointerUp={(e) => onWrapPointerUp(e, i)}
              onPointerCancel={(e) => onWrapPointerUp(e, i)}
            >
              <EntryCard
                section={s}
                index={i}
                sectionNumbers={sectionNumbers}
                aiConfigured={
                  tutorial
                    ? tutorialAskAiIndex === i
                    : aiConfigured
                }
                busy={busy}
                aiWorking={busySectionIndex === i}
                aiError={aiErrors[i] ?? null}
                focused={focusedSectionIndex === i || dragging}
                dwelling={
                  dwellSectionIndex === i && !dragging && holdArm?.index !== i
                }
                liftCompact={dragging}
                onChange={onChange}
                onAskAi={onAskAi}
                onDismissAiError={onDismissAiError}
                onActivate={onFocusSection}
                onAnnotate={openAnnotate}
                onDelete={onDeleteSection}
              />
            </div>
          </div>
        );
      })}
      {drag && dropBeforeIndex === sections.length && (
        <div className="section-drop-line" aria-hidden />
      )}

      <div className="review-add-notes">
        <button
          type="button"
          className="btn big review-add-notes-btn"
          disabled={busy || !!drag || tutorial}
          onClick={() => {
            if (tutorial) return;
            onAddMoreNotes();
          }}
        >
          Add more notes
        </button>
      </div>

      {drag &&
        ghostSection &&
        createPortal(
          <div
            ref={(el) => {
              ghostElRef.current = el;
              if (el) applyGhostPose();
            }}
            className="section-lift-ghost"
            aria-hidden
          >
            <EntryCard
              section={ghostSection}
              index={drag.from}
              sectionNumbers={sectionNumbers}
              aiConfigured={aiConfigured}
              busy
              aiWorking={false}
              aiError={null}
              focused
              dwelling={false}
              liftCompact
              dragPreview
              onChange={() => {}}
              onAskAi={() => {}}
              onDismissAiError={() => {}}
            />
          </div>,
          document.body
        )}

      <div className="bottom-bar">
        <button
          type="button"
          className="btn primary big"
          disabled={busy || !!drag || !!annotate || lockContinue}
          onClick={onContinue}
        >
          Continue to report details
        </button>
      </div>

      {annotate && (
        <AnnotationOverlay
          imageUrl={annotate.url}
          imageWidth={annotate.width}
          imageHeight={annotate.height}
          initial={annotate.initial}
          initialCrop={annotate.initialCrop}
          onFinished={finishAnnotate}
        />
      )}
    </div>
  );
}
