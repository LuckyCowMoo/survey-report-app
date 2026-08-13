import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from "react";
import { createPortal } from "react-dom";
import type { NormPoint, PhotoAnnotation } from "../types";
import { hitTestAnnotation, recognizeStroke } from "../lib/shapeRecognize";
import { buildEdgeField, type EdgeField } from "../lib/edgeField";
import { calloutAttachPoint, calloutMetrics } from "../lib/callout";

type Tool = "draw" | "erase";

type Props = {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  initial: PhotoAnnotation[];
  onFinished: (annotations: PhotoAnnotation[]) => void;
};

const HISTORY_CAP = 50;
const DOUBLE_TAP_MS = 420;
const DOUBLE_TAP_PX = 28;
const TAP_TRAVEL_MAX = 0.018;
const DESELECT_MOVE_PX = 18;
const LONG_PRESS_MS = 480;
const LONG_PRESS_MOVE_PX = 12;
const ZOOM_MIN = 1;
const ZOOM_MAX = 5;
const INK = "#e11d2e";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

type ModePulse = {
  id: number;
  x: number;
  y: number;
  mode: Tool;
};

type BrushCursor = {
  x: number;
  y: number;
  mode: Tool;
};

type CtxMenu = {
  clientX: number;
  clientY: number;
  norm: NormPoint;
};

function clamp01(n: number): number {
  return clamp(n, 0, 1);
}

function newAnnId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `ann-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cloneAnns(list: PhotoAnnotation[]): PhotoAnnotation[] {
  return list.map((a) => structuredClone(a));
}

function arrowHeadPoints(
  tip: NormPoint,
  tail: NormPoint
): { left: NormPoint; right: NormPoint } {
  const dx = tip.x - tail.x;
  const dy = tip.y - tail.y;
  const len = Math.hypot(dx, dy) || 1;
  const head = Math.min(0.06, Math.max(0.02, len * 0.28));
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;
  const baseX = tip.x - ux * head;
  const baseY = tip.y - uy * head;
  const wing = head * 0.55;
  return {
    left: { x: baseX + px * wing, y: baseY + py * wing },
    right: { x: baseX - px * wing, y: baseY - py * wing }
  };
}

export default function AnnotationOverlay({
  imageUrl,
  imageWidth,
  imageHeight,
  initial,
  onFinished
}: Props) {
  const [enterClass, setEnterClass] = useState(false);
  const [tool, setTool] = useState<Tool>("draw");
  const [annotations, setAnnotations] = useState<PhotoAnnotation[]>(() =>
    cloneAnns(initial)
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [liveStroke, setLiveStroke] = useState<NormPoint[] | null>(null);
  const [past, setPast] = useState<PhotoAnnotation[][]>([]);
  const [future, setFuture] = useState<PhotoAnnotation[][]>([]);
  const [modePulses, setModePulses] = useState<ModePulse[]>([]);
  const [brushCursor, setBrushCursor] = useState<BrushCursor | null>(null);
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
  const [shapeDetect, setShapeDetect] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [baseW, setBaseW] = useState(0);

  const imgBoxRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const zoomLayerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const hitRef = useRef<HTMLDivElement>(null);
  const drawingRef = useRef(false);
  const strokeMovedRef = useRef(false);
  const toolRef = useRef<Tool>(tool);
  toolRef.current = tool;
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const liveStrokeRef = useRef<NormPoint[]>([]);
  const liveRafRef = useRef(0);
  const eraseIdsRef = useRef<Set<string>>(new Set());
  const eraseSnapshotRef = useRef<PhotoAnnotation[] | null>(null);
  const handleDragRef = useRef<{
    id: string;
    handle: string;
    snapshot: PhotoAnnotation;
    committed: boolean;
  } | null>(null);
  const lastTapRef = useRef<{ t: number; x: number; y: number } | null>(null);
  const suppressTapRef = useRef(false);
  const pendingDeselectRef = useRef<{
    startClientX: number;
    startClientY: number;
    startNorm: NormPoint;
  } | null>(null);
  const pulseIdRef = useRef(0);
  const edgeFieldRef = useRef<EdgeField | null>(null);
  const shapeDetectRef = useRef(shapeDetect);
  shapeDetectRef.current = shapeDetect;
  const longPressTimerRef = useRef<number | null>(null);
  const pendingGestureRef = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    norm: NormPoint;
  } | null>(null);
  const menuOpenedByGestureRef = useRef(false);
  /** Ignore hit-layer presses briefly after closing the context menu (click-through). */
  const suppressHitUntilRef = useRef(0);
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  const pointersRef = useRef(
    new Map<number, { x: number; y: number; type: string }>()
  );
  const pinchRef = useRef<{
    startDist: number;
    startZoom: number;
    startPanX: number;
    startPanY: number;
    startMidX: number;
    startMidY: number;
  } | null>(null);
  const pinchTouchesRef = useRef<
    [{ x: number; y: number }, { x: number; y: number }] | null
  >(null);
  const suppressWheelUntilRef = useRef(0);
  const viewRafRef = useRef(0);
  const pinchApiRef = useRef({
    begin: () => {},
    update: () => {},
    end: () => {},
    commit: (_z: number, _p: { x: number; y: number }) => {}
  });
  if (!pinchRef.current) {
    zoomRef.current = zoom;
    panRef.current = pan;
  }

  const aspect = imageHeight / Math.max(1, imageWidth);
  const aspectRef = useRef(aspect);
  aspectRef.current = aspect;

  useEffect(() => {
    const id = requestAnimationFrame(() => setEnterClass(true));
    const done = window.setTimeout(() => setEnterClass(false), 420);
    return () => {
      cancelAnimationFrame(id);
      window.clearTimeout(done);
      if (liveRafRef.current) cancelAnimationFrame(liveRafRef.current);
      if (viewRafRef.current) cancelAnimationFrame(viewRafRef.current);
      if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    edgeFieldRef.current = null;
    void buildEdgeField(imageUrl).then((field) => {
      if (!cancelled) edgeFieldRef.current = field;
    });
    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  const [photoWidth, setPhotoWidth] = useState(360);

  useEffect(() => {
    if (baseW > 1) setPhotoWidth(baseW);
  }, [baseW]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const update = () => {
      const r = stage.getBoundingClientRect();
      const maxW = Math.max(80, r.width - 24);
      const maxH = Math.max(80, r.height - 16);
      const s = Math.min(maxW / imageWidth, maxH / imageHeight);
      setBaseW(Math.max(40, imageWidth * s));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [imageWidth, imageHeight]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const html = document.documentElement;
    const body = document.body;
    const prevHtmlTouch = html.style.touchAction;
    const prevBodyTouch = body.style.touchAction;
    html.style.touchAction = "none";
    body.style.touchAction = "none";
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";

    const pinchWheelActive = () =>
      Boolean(pinchRef.current) ||
      Boolean(pinchTouchesRef.current) ||
      pointersRef.current.size >= 2 ||
      performance.now() < suppressWheelUntilRef.current;

    const onWheel = (e: WheelEvent) => {
      if (pinchWheelActive()) {
        e.preventDefault();
        return;
      }
      if (!stage.contains(e.target as Node)) return;
      e.preventDefault();
      const sr = stage.getBoundingClientRect();
      const cx = sr.left + sr.width / 2;
      const cy = sr.top + sr.height / 2;
      const prev = zoomRef.current;
      const factor = e.ctrlKey
        ? Math.exp(-e.deltaY * 0.01)
        : e.deltaY < 0
          ? 1.1
          : 1 / 1.1;
      const nextZoom = clamp(prev * factor, ZOOM_MIN, ZOOM_MAX);
      if (nextZoom <= ZOOM_MIN + 1e-6) {
        pinchApiRef.current.commit(1, { x: 0, y: 0 });
        return;
      }
      const relX = (e.clientX - cx - panRef.current.x) / prev;
      const relY = (e.clientY - cy - panRef.current.y) / prev;
      pinchApiRef.current.commit(nextZoom, {
        x: e.clientX - cx - relX * nextZoom,
        y: e.clientY - cy - relY * nextZoom
      });
    };

    const preventNativeZoom = (ev: Event) => {
      ev.preventDefault();
    };

    const readTouches = (
      e: TouchEvent
    ): [{ x: number; y: number }, { x: number; y: number }] | null => {
      if (e.touches.length < 2) return null;
      const a = e.touches[0];
      const b = e.touches[1];
      if (!a || !b) return null;
      return [
        { x: a.clientX, y: a.clientY },
        { x: b.clientX, y: b.clientY }
      ];
    };

    const onTouchStart = (e: TouchEvent) => {
      const pts = readTouches(e);
      if (!pts) return;
      e.preventDefault();
      if (!stage.contains(e.target as Node) && !pinchRef.current) return;
      pinchTouchesRef.current = pts;
      pinchApiRef.current.begin();
    };

    const onTouchMove = (e: TouchEvent) => {
      const pts = readTouches(e);
      if (!pts) return;
      e.preventDefault();
      if (!pinchRef.current && !stage.contains(e.target as Node)) return;
      pinchTouchesRef.current = pts;
      if (!pinchRef.current) pinchApiRef.current.begin();
      pinchApiRef.current.update();
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        const pts = readTouches(e);
        if (pts) pinchTouchesRef.current = pts;
        return;
      }
      pinchTouchesRef.current = null;
      pinchApiRef.current.end();
    };

    const opts = { passive: false, capture: true } as const;
    window.addEventListener("wheel", onWheel, opts);
    document.addEventListener("gesturestart", preventNativeZoom, opts);
    document.addEventListener("gesturechange", preventNativeZoom, opts);
    document.addEventListener("gestureend", preventNativeZoom, opts);
    document.addEventListener("touchstart", onTouchStart, opts);
    document.addEventListener("touchmove", onTouchMove, opts);
    document.addEventListener("touchend", onTouchEnd, opts);
    document.addEventListener("touchcancel", onTouchEnd, opts);
    return () => {
      html.style.touchAction = prevHtmlTouch;
      body.style.touchAction = prevBodyTouch;
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
      window.removeEventListener("wheel", onWheel, true);
      document.removeEventListener("gesturestart", preventNativeZoom, true);
      document.removeEventListener("gesturechange", preventNativeZoom, true);
      document.removeEventListener("gestureend", preventNativeZoom, true);
      document.removeEventListener("touchstart", onTouchStart, true);
      document.removeEventListener("touchmove", onTouchMove, true);
      document.removeEventListener("touchend", onTouchEnd, true);
      document.removeEventListener("touchcancel", onTouchEnd, true);
    };
    // pinch helpers are stable enough via refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pushHistory = (next: PhotoAnnotation[]) => {
    const snapshot = cloneAnns(annotationsRef.current);
    annotationsRef.current = next;
    setPast((p) => {
      const stacked = [...p, snapshot];
      return stacked.length > HISTORY_CAP
        ? stacked.slice(stacked.length - HISTORY_CAP)
        : stacked;
    });
    setFuture([]);
    setAnnotations(next);
  };

  const undo = () => {
    setPast((p) => {
      if (p.length === 0) return p;
      const prev = p[p.length - 1]!;
      setFuture((f) =>
        [cloneAnns(annotationsRef.current), ...f].slice(0, HISTORY_CAP)
      );
      setAnnotations(cloneAnns(prev));
      setSelectedId(null);
      return p.slice(0, -1);
    });
  };

  const redo = () => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const next = f[0]!;
      setPast((p) =>
        [...p, cloneAnns(annotationsRef.current)].slice(-HISTORY_CAP)
      );
      setAnnotations(cloneAnns(next));
      setSelectedId(null);
      return f.slice(1);
    });
  };

  const clientToNorm = (clientX: number, clientY: number): NormPoint | null => {
    const box = imgBoxRef.current;
    if (!box) return null;
    const r = box.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return null;
    return {
      x: Math.max(0, Math.min(1, (clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (clientY - r.top) / r.height))
    };
  };

  const queueLiveStroke = () => {
    if (liveRafRef.current) return;
    liveRafRef.current = requestAnimationFrame(() => {
      liveRafRef.current = 0;
      setLiveStroke([...liveStrokeRef.current]);
    });
  };

  const markErased = (id: string) => {
    if (eraseIdsRef.current.has(id)) return;
    eraseIdsRef.current.add(id);
    const node = svgRef.current?.querySelector(
      `[data-ann-id="${CSS.escape(id)}"]`
    );
    if (node instanceof SVGElement) node.style.opacity = "0";
  };

  const endHandleDrag = () => {
    handleDragRef.current = null;
  };

  const strokeTravel = (pts: NormPoint[]): number => {
    let t = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      t += Math.hypot(b.x - a.x, b.y - a.y);
    }
    return t;
  };

  const spawnModePulse = (clientX: number, clientY: number, mode: Tool) => {
    const box = imgBoxRef.current;
    if (!box) return;
    const r = box.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    const id = ++pulseIdRef.current;
    const pulse: ModePulse = {
      id,
      x: ((clientX - r.left) / r.width) * 100,
      y: ((clientY - r.top) / r.height) * 100,
      mode
    };
    setModePulses((list) => [...list, pulse]);
    window.setTimeout(() => {
      setModePulses((list) => list.filter((p) => p.id !== id));
    }, 520);
  };

  const toggleToolAt = (clientX: number, clientY: number) => {
    const next: Tool = toolRef.current === "draw" ? "erase" : "draw";
    setTool(next);
    spawnModePulse(clientX, clientY, next);
    pendingDeselectRef.current = null;
    setBrushCursor(null);
  };

  const endDrawOrErase = () => {
    if (pendingDeselectRef.current) {
      pendingDeselectRef.current = null;
      setSelectedId(null);
      setBrushCursor(null);
      return;
    }

    if (!drawingRef.current) return;
    drawingRef.current = false;
    setBrushCursor(null);

    if (toolRef.current === "erase") {
      const removed = eraseIdsRef.current;
      const snapshot = eraseSnapshotRef.current;
      eraseSnapshotRef.current = null;
      eraseIdsRef.current = new Set();
      if (snapshot && removed.size > 0) {
        const next = snapshot.filter((a) => !removed.has(a.id));
        requestAnimationFrame(() => {
          setPast((p) => {
            const stacked = [...p, cloneAnns(snapshot)];
            return stacked.length > HISTORY_CAP
              ? stacked.slice(stacked.length - HISTORY_CAP)
              : stacked;
          });
          setFuture([]);
          setAnnotations(next);
          setSelectedId(null);
        });
      } else {
        svgRef.current
          ?.querySelectorAll<SVGElement>("[data-ann-id]")
          .forEach((n) => {
            n.style.opacity = "";
          });
      }
      liveStrokeRef.current = [];
      setLiveStroke(null);
      return;
    }

    const stroke = liveStrokeRef.current;
    liveStrokeRef.current = [];
    setLiveStroke(null);
    if (stroke.length < 2 || !strokeMovedRef.current) {
      suppressTapRef.current = false;
      return;
    }
    // Finger jitter on a tap must not block the second half of a double-tap.
    if (strokeTravel(stroke) < TAP_TRAVEL_MAX) {
      suppressTapRef.current = false;
      return;
    }
    suppressTapRef.current = true;
    const recognized = recognizeStroke(stroke, edgeFieldRef.current, {
      detectShapes: shapeDetectRef.current
    });
    if (!recognized) return;
    pushHistory([...annotationsRef.current, recognized]);
    setSelectedId(recognized.id);
  };

  const maybeDoubleTap = (clientX: number, clientY: number): boolean => {
    const now = performance.now();
    // A just-finished stroke must not pair with the next tap — but that next
    // tap still counts as the first half of a double-tap (e.g. deselect + switch).
    if (suppressTapRef.current) {
      suppressTapRef.current = false;
      lastTapRef.current = { t: now, x: clientX, y: clientY };
      return false;
    }
    const prev = lastTapRef.current;
    lastTapRef.current = { t: now, x: clientX, y: clientY };
    if (!prev) return false;
    if (now - prev.t > DOUBLE_TAP_MS) return false;
    if (Math.hypot(clientX - prev.x, clientY - prev.y) > DOUBLE_TAP_PX)
      return false;
    lastTapRef.current = null;
    toggleToolAt(clientX, clientY);
    return true;
  };

  const clearLongPress = () => {
    if (longPressTimerRef.current != null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const closeCtxMenu = () => {
    setCtxMenu(null);
    // Menu buttons sit over the hit layer — the same tap can fall through.
    suppressHitUntilRef.current = performance.now() + 450;
  };

  const cancelActiveStroke = () => {
    clearLongPress();
    pendingGestureRef.current = null;
    pendingDeselectRef.current = null;
    drawingRef.current = false;
    strokeMovedRef.current = false;
    liveStrokeRef.current = [];
    setLiveStroke(null);
    setBrushCursor(null);
    if (toolRef.current === "erase") {
      eraseIdsRef.current = new Set();
      eraseSnapshotRef.current = null;
      svgRef.current
        ?.querySelectorAll<SVGElement>("[data-ann-id]")
        .forEach((n) => {
          n.style.opacity = "";
        });
    }
  };

  const applyView = (nextZoom: number, nextPan: { x: number; y: number }) => {
    zoomRef.current = nextZoom;
    panRef.current = nextPan;
    const el = zoomLayerRef.current;
    if (!el) return;
    el.style.transform = `translate3d(${nextPan.x}px, ${nextPan.y}px, 0) scale(${nextZoom})`;
  };

  const commitView = (nextZoom: number, nextPan: { x: number; y: number }) => {
    applyView(nextZoom, nextPan);
    setZoom(nextZoom);
    setPan(nextPan);
  };

  const scheduleViewCommit = () => {
    if (viewRafRef.current) return;
    viewRafRef.current = requestAnimationFrame(() => {
      viewRafRef.current = 0;
      setZoom(zoomRef.current);
      setPan(panRef.current);
    });
  };

  const endPinch = () => {
    if (!pinchRef.current) return;
    pinchRef.current = null;
    pinchTouchesRef.current = null;
    suppressWheelUntilRef.current = performance.now() + 500;
    if (viewRafRef.current) {
      cancelAnimationFrame(viewRafRef.current);
      viewRafRef.current = 0;
    }
    setZoom(zoomRef.current);
    setPan(panRef.current);
  };

  const pinchPoints = ():
    | [{ x: number; y: number }, { x: number; y: number }]
    | null => {
    if (pinchTouchesRef.current) return pinchTouchesRef.current;
    const all = [...pointersRef.current.values()];
    const preferred = all.filter((p) => p.type !== "mouse");
    const pts = (preferred.length >= 2 ? preferred : all).slice(0, 2);
    const a = pts[0];
    const b = pts[1];
    if (!a || !b) return null;
    return [a, b];
  };

  const beginPinchIfNeeded = () => {
    if (pinchRef.current) return;
    const pts = pinchPoints();
    if (!pts) return;
    cancelActiveStroke();
    const [a, b] = pts;
    pinchRef.current = {
      startDist: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
      startZoom: zoomRef.current,
      startPanX: panRef.current.x,
      startPanY: panRef.current.y,
      startMidX: (a.x + b.x) / 2,
      startMidY: (a.y + b.y) / 2
    };
  };

  const updatePinch = () => {
    const pinch = pinchRef.current;
    const stage = stageRef.current;
    const pts = pinchPoints();
    if (!pinch || !stage || !pts) return;
    const [a, b] = pts;
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    if (dist < 1) return;

    let scale = dist / pinch.startDist;
    if (scale < 1) scale = Math.pow(scale, 1.12);
    const nextZoom = clamp(pinch.startZoom * scale, ZOOM_MIN, ZOOM_MAX);

    let nextPanX = pinch.startPanX + (midX - pinch.startMidX);
    let nextPanY = pinch.startPanY + (midY - pinch.startMidY);

    if (nextZoom <= ZOOM_MIN + 1e-6) {
      if (pinch.startZoom > ZOOM_MIN + 1e-6) {
        applyView(1, { x: 0, y: 0 });
      } else {
        applyView(1, { x: nextPanX, y: nextPanY });
      }
      scheduleViewCommit();
      return;
    }

    if (Math.abs(nextZoom - pinch.startZoom) > 1e-4) {
      const sr = stage.getBoundingClientRect();
      const cx = sr.left + sr.width / 2;
      const cy = sr.top + sr.height / 2;
      const relX = (pinch.startMidX - cx - pinch.startPanX) / pinch.startZoom;
      const relY = (pinch.startMidY - cy - pinch.startPanY) / pinch.startZoom;
      nextPanX = midX - cx - relX * nextZoom;
      nextPanY = midY - cy - relY * nextZoom;
    }

    applyView(nextZoom, { x: nextPanX, y: nextPanY });
    scheduleViewCommit();
  };

  pinchApiRef.current = {
    begin: beginPinchIfNeeded,
    update: updatePinch,
    end: endPinch,
    commit: commitView
  };

  const openCtxMenu = (clientX: number, clientY: number, norm: NormPoint) => {
    clearLongPress();
    pendingGestureRef.current = null;
    pendingDeselectRef.current = null;
    drawingRef.current = false;
    liveStrokeRef.current = [];
    setLiveStroke(null);
    setBrushCursor(null);
    menuOpenedByGestureRef.current = true;
    lastTapRef.current = null;
    setCtxMenu({ clientX, clientY, norm });
  };

  const applyPendingGesture = () => {
    const g = pendingGestureRef.current;
    if (!g) return;
    pendingGestureRef.current = null;
    clearLongPress();
    const p = g.norm;

    if (toolRef.current === "erase") {
      beginEraseStroke(p);
      return;
    }

    const hit = hitTestAnnotation(
      annotationsRef.current,
      p,
      0.04,
      aspectRef.current
    );
    if (hit && hit.kind !== "freehand") {
      pendingDeselectRef.current = null;
      setSelectedId(hit.id);
      strokeMovedRef.current = false;
      drawingRef.current = false;
      liveStrokeRef.current = [];
      setLiveStroke(null);
      setBrushCursor(null);
      return;
    }

    if (selectedIdRef.current) {
      pendingDeselectRef.current = {
        startClientX: g.clientX,
        startClientY: g.clientY,
        startNorm: p
      };
      drawingRef.current = false;
      liveStrokeRef.current = [];
      setLiveStroke(null);
      setBrushCursor(null);
      return;
    }

    beginDrawStroke(p);
  };

  const spawnShape = (
    kind: "arrow" | "circle" | "line" | "callout",
    at?: NormPoint
  ) => {
    const origin = at ?? { x: 0.5, y: 0.45 };
    const id = newAnnId();
    let ann: PhotoAnnotation;
    if (kind === "arrow") {
      ann = {
        id,
        kind: "arrow",
        tip: { x: clamp01(origin.x), y: clamp01(origin.y) },
        tail: { x: clamp01(origin.x - 0.14), y: clamp01(origin.y) }
      };
    } else if (kind === "circle") {
      ann = {
        id,
        kind: "circle",
        center: { x: clamp01(origin.x), y: clamp01(origin.y) },
        radius: 0.08
      };
    } else if (kind === "callout") {
      ann = {
        id,
        kind: "callout",
        anchor: { x: clamp01(origin.x), y: clamp01(origin.y) },
        label: {
          x: clamp01(origin.x + 0.06),
          y: clamp01(origin.y - 0.08)
        },
        text: "Note"
      };
    } else {
      ann = {
        id,
        kind: "line",
        a: { x: clamp01(origin.x - 0.1), y: clamp01(origin.y) },
        b: { x: clamp01(origin.x + 0.1), y: clamp01(origin.y) }
      };
    }
    pushHistory([...annotationsRef.current, ann]);
    selectedIdRef.current = id;
    setSelectedId(id);
    setTool("draw");
    closeCtxMenu();
  };

  const updateCalloutText = (id: string, text: string) => {
    const clipped = text.slice(0, 80);
    const next = annotationsRef.current.map((a) =>
      a.id === id && a.kind === "callout" ? { ...a, text: clipped } : a
    );
    annotationsRef.current = next;
    setAnnotations(next);
  };

  const commitCalloutText = (id: string, fromText: string, toText: string) => {
    const clipped = toText.slice(0, 80);
    if (fromText === clipped) return;
    const withOrigin = annotationsRef.current.map((a) =>
      a.id === id && a.kind === "callout" ? { ...a, text: fromText } : a
    );
    const withNext = withOrigin.map((a) =>
      a.id === id && a.kind === "callout" ? { ...a, text: clipped } : a
    );
    annotationsRef.current = withOrigin;
    pushHistory(withNext);
  };

  const beginDrawStroke = (p: NormPoint) => {
    drawingRef.current = true;
    strokeMovedRef.current = false;
    setSelectedId(null);
    liveStrokeRef.current = [p];
    setLiveStroke([p]);
    setBrushCursor({ x: p.x, y: p.y, mode: "draw" });
  };

  const beginEraseStroke = (p: NormPoint) => {
    drawingRef.current = true;
    strokeMovedRef.current = false;
    eraseIdsRef.current = new Set();
    eraseSnapshotRef.current = cloneAnns(annotationsRef.current);
    setBrushCursor({ x: p.x, y: p.y, mode: "erase" });
    const hit = hitTestAnnotation(
      annotationsRef.current,
      p,
      0.036,
      aspectRef.current
    );
    if (hit) markErased(hit.id);
  };

  const onHitPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if (handleDragRef.current) return;

    if (pinchRef.current && e.pointerType === "mouse") {
      e.preventDefault();
      return;
    }
    pointersRef.current.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY,
      type: e.pointerType
    });
    if (pinchPoints()) {
      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      beginPinchIfNeeded();
      return;
    }

    if (drawingRef.current) return;

    if (performance.now() < suppressHitUntilRef.current) {
      e.preventDefault();
      return;
    }

    if (ctxMenu) {
      closeCtxMenu();
      e.preventDefault();
      return;
    }

    if (maybeDoubleTap(e.clientX, e.clientY)) {
      e.preventDefault();
      return;
    }

    const p = clientToNorm(e.clientX, e.clientY);
    if (!p) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);

    menuOpenedByGestureRef.current = false;
    pendingGestureRef.current = {
      pointerId: e.pointerId,
      clientX: e.clientX,
      clientY: e.clientY,
      norm: p
    };
    clearLongPress();
    longPressTimerRef.current = window.setTimeout(() => {
      const g = pendingGestureRef.current;
      if (!g || g.pointerId !== e.pointerId) return;
      openCtxMenu(g.clientX, g.clientY, g.norm);
    }, LONG_PRESS_MS);
  };

  const onHitPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY,
        type: e.pointerType
      });
    }

    if (pinchRef.current) {
      e.preventDefault();
      updatePinch();
      return;
    }

    if (handleDragRef.current) {
      const drag = handleDragRef.current;
      const p = clientToNorm(e.clientX, e.clientY);
      if (!p) return;
      e.preventDefault();
      if (!drag.committed) {
        drag.committed = true;
        setPast((pastList) => {
          const stacked = [...pastList, cloneAnns(annotationsRef.current)];
          return stacked.length > HISTORY_CAP
            ? stacked.slice(stacked.length - HISTORY_CAP)
            : stacked;
        });
        setFuture([]);
      }
      setAnnotations((list) =>
        list.map((a) => {
          if (a.id !== drag.id) return a;
          const snap = drag.snapshot;
          if (snap.kind === "line") {
            if (drag.handle === "a") return { ...snap, a: p };
            if (drag.handle === "b") return { ...snap, b: p };
          }
          if (snap.kind === "arrow") {
            if (drag.handle === "tail") return { ...snap, tail: p };
            if (drag.handle === "tip") return { ...snap, tip: p };
          }
          if (snap.kind === "callout") {
            if (drag.handle === "anchor") return { ...snap, anchor: p };
            if (drag.handle === "label") return { ...snap, label: p };
          }
          if (snap.kind === "circle") {
            if (drag.handle === "center") return { ...snap, center: p };
            if (drag.handle === "rim") {
              const dx = p.x - snap.center.x;
              const dy = (p.y - snap.center.y) * aspectRef.current;
              return { ...snap, radius: Math.max(0.01, Math.hypot(dx, dy)) };
            }
          }
          if (snap.kind === "polyline" && drag.handle.startsWith("v:")) {
            const idx = Number(drag.handle.slice(2));
            if (!Number.isFinite(idx) || idx < 0 || idx >= snap.points.length) {
              return a;
            }
            const points = snap.points.map((pt, i) => (i === idx ? p : pt));
            return { ...snap, points };
          }
          return a;
        })
      );
      return;
    }

    const pending = pendingGestureRef.current;
    if (pending && pending.pointerId === e.pointerId) {
      const moved = Math.hypot(
        e.clientX - pending.clientX,
        e.clientY - pending.clientY
      );
      if (moved < LONG_PRESS_MOVE_PX) return;
      applyPendingGesture();
    }

    if (menuOpenedByGestureRef.current || ctxMenu) return;

    const pendingDeselect = pendingDeselectRef.current;
    if (pendingDeselect) {
      const moved = Math.hypot(
        e.clientX - pendingDeselect.startClientX,
        e.clientY - pendingDeselect.startClientY
      );
      if (moved < DESELECT_MOVE_PX) return;
      e.preventDefault();
      pendingDeselectRef.current = null;
      const p = clientToNorm(e.clientX, e.clientY);
      if (!p) return;
      beginDrawStroke(pendingDeselect.startNorm);
      liveStrokeRef.current.push(p);
      strokeMovedRef.current = true;
      queueLiveStroke();
      setBrushCursor({ x: p.x, y: p.y, mode: "draw" });
      return;
    }

    if (!drawingRef.current) return;
    const p = clientToNorm(e.clientX, e.clientY);
    if (!p) return;
    e.preventDefault();
    strokeMovedRef.current = true;
    setBrushCursor({
      x: p.x,
      y: p.y,
      mode: toolRef.current
    });

    if (toolRef.current === "erase") {
      const remaining = annotationsRef.current.filter(
        (a) => !eraseIdsRef.current.has(a.id)
      );
      const hit = hitTestAnnotation(remaining, p, 0.032, aspectRef.current);
      if (hit) markErased(hit.id);
      return;
    }

    liveStrokeRef.current.push(p);
    queueLiveStroke();
  };

  const onHitPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(e.pointerId);
    if (!pinchPoints()) {
      endPinch();
    }
    clearLongPress();
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      /* ignore */
    }
    if (handleDragRef.current) {
      endHandleDrag();
      return;
    }
    // Ending a pinch: don't treat as draw/tap.
    if (pointersRef.current.size > 0) return;
    if (menuOpenedByGestureRef.current) {
      menuOpenedByGestureRef.current = false;
      pendingGestureRef.current = null;
      return;
    }
    if (pendingGestureRef.current) {
      applyPendingGesture();
    }
    endDrawOrErase();
  };

  const onHandlePointerDown = (
    e: ReactPointerEvent<HTMLButtonElement>,
    annId: string,
    handle: string
  ) => {
    e.stopPropagation();
    e.preventDefault();
    const ann = annotationsRef.current.find((a) => a.id === annId);
    if (!ann) return;
    const p = clientToNorm(e.clientX, e.clientY);
    if (!p) return;
    // Route handle drags through the hit surface capture.
    handleDragRef.current = {
      id: annId,
      handle,
      snapshot: structuredClone(ann),
      committed: false
    };
    setSelectedId(annId);
    const hit = hitRef.current;
    if (hit) {
      try {
        hit.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
  };

  const selected = annotations.find((a) => a.id === selectedId) ?? null;
  const toPct = (p: NormPoint) => ({
    left: `${p.x * 100}%`,
    top: `${p.y * 100}%`
  });

  const ui = (
    <div
      className="annotation-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Annotate photo"
      onContextMenu={(e) => e.preventDefault()}
      style={{ ["--ann-zoom" as string]: String(zoom) }}
    >
      <div className="annotation-overlay-scrim" aria-hidden />
      {ctxMenu && (
        <div
          className="annotation-ctx"
          style={{ left: ctxMenu.clientX, top: ctxMenu.clientY }}
          role="menu"
          aria-label="Annotation tools"
        >
          <div className="annotation-ctx-plate" aria-hidden />
          <div className="annotation-ctx-finger" aria-hidden />

          <div className="annotation-ctx-slot annotation-ctx-slot-detect">
            <label className="annotation-ctx-switch">
              <span className="annotation-ctx-switch-label">Auto shape</span>
              <button
                type="button"
                role="switch"
                className={`annotation-ctx-toggle${shapeDetect ? " is-on" : ""}`}
                aria-checked={shapeDetect}
                aria-label="Auto shape"
                onClick={() => setShapeDetect((v) => !v)}
              >
                <span className="annotation-ctx-toggle-knob" />
              </button>
            </label>
          </div>

          <div className="annotation-ctx-slot annotation-ctx-slot-history">
            <button
              type="button"
              role="menuitem"
              className="annotation-ctx-btn"
              aria-label="Undo"
              disabled={past.length === 0}
              onClick={() => {
                undo();
                closeCtxMenu();
              }}
            >
              <LucideUndoIcon />
            </button>
            <button
              type="button"
              role="menuitem"
              className="annotation-ctx-btn"
              aria-label="Redo"
              disabled={future.length === 0}
              onClick={() => {
                redo();
                closeCtxMenu();
              }}
            >
              <LucideRedoIcon />
            </button>
          </div>

          <div className="annotation-ctx-slot annotation-ctx-slot-tools">
            <button
              type="button"
              role="menuitem"
              className={`annotation-ctx-btn${tool === "erase" ? " is-active" : ""}`}
              aria-label="Eraser"
              aria-pressed={tool === "erase"}
              onClick={() => {
                setTool("erase");
                closeCtxMenu();
              }}
            >
              <LucideEraserIcon />
            </button>
            <button
              type="button"
              role="menuitem"
              className={`annotation-ctx-btn${tool === "draw" ? " is-active" : ""}`}
              aria-label="Brush"
              aria-pressed={tool === "draw"}
              onClick={() => {
                setTool("draw");
                closeCtxMenu();
              }}
            >
              <LucideBrushIcon />
            </button>
          </div>

          <div className="annotation-ctx-slot annotation-ctx-slot-shapes">
            <button
              type="button"
              role="menuitem"
              className="annotation-ctx-btn"
              aria-label="Add arrow"
              onClick={() => spawnShape("arrow", ctxMenu.norm)}
            >
              <LucideArrowIcon />
            </button>
            <button
              type="button"
              role="menuitem"
              className="annotation-ctx-btn"
              aria-label="Add circle"
              onClick={() => spawnShape("circle", ctxMenu.norm)}
            >
              <LucideCircleIcon />
            </button>
            <button
              type="button"
              role="menuitem"
              className="annotation-ctx-btn"
              aria-label="Add line"
              onClick={() => spawnShape("line", ctxMenu.norm)}
            >
              <LucideLineIcon />
            </button>
            <button
              type="button"
              role="menuitem"
              className="annotation-ctx-btn"
              aria-label="Add text note"
              onClick={() => spawnShape("callout", ctxMenu.norm)}
            >
              <LucideTypeIcon />
            </button>
          </div>
        </div>
      )}
      <div className="annotation-overlay-stage" ref={stageRef}>
        <div
          ref={zoomLayerRef}
          className="annotation-zoom-layer"
          style={{
            width: baseW > 0 ? baseW : undefined,
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`
          }}
        >
          <div
            className={`annotation-overlay-photo${enterClass ? " is-entering" : ""}${baseW > 0 ? " is-sized" : ""}`}
            ref={imgBoxRef}
          >
            <img src={imageUrl} alt="" draggable={false} />
            <svg
              ref={svgRef}
              className="annotation-overlay-svg"
              viewBox="0 0 1 1"
              preserveAspectRatio="none"
              aria-hidden
            >
              {annotations.map((ann) => (
                <g key={ann.id} data-ann-id={ann.id}>
                  <AnnotationPath
                    ann={ann}
                    aspect={aspect}
                    photoWidth={photoWidth}
                    selected={ann.id === selectedId}
                  />
                </g>
              ))}
              {liveStroke && liveStroke.length > 1 && (
                <polyline
                  fill="none"
                  stroke={INK}
                  strokeWidth={0.006}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={liveStroke.map((p) => `${p.x},${p.y}`).join(" ")}
                />
              )}
            </svg>

            <div
              ref={hitRef}
              className="annotation-overlay-hit"
              onPointerDown={onHitPointerDown}
              onPointerMove={onHitPointerMove}
              onPointerUp={onHitPointerUp}
              onPointerCancel={onHitPointerUp}
            />

            {annotations.map((ann) =>
              ann.kind === "callout" ? (
                <CalloutLabel
                  key={`label-${ann.id}`}
                  ann={ann}
                  editing={ann.id === selectedId && tool === "draw"}
                  onLiveChange={(text) => updateCalloutText(ann.id, text)}
                  onCommit={(from, to) => commitCalloutText(ann.id, from, to)}
                />
              ) : null
            )}

            {brushCursor && (
              <div
                className={`annotation-brush-cursor is-${brushCursor.mode}`}
                style={{
                  left: `${brushCursor.x * 100}%`,
                  top: `${brushCursor.y * 100}%`
                }}
                aria-hidden
              />
            )}

            {modePulses.map((pulse) => (
              <div
                key={pulse.id}
                className={`annotation-mode-pulse is-${pulse.mode}`}
                style={{ left: `${pulse.x}%`, top: `${pulse.y}%` }}
                aria-hidden
              />
            ))}

            {selected && tool === "draw" && (
            <div className="annotation-handles" aria-hidden>
              {selected.kind === "line" && (
                <>
                  <Handle
                    style={toPct(selected.a)}
                    onPointerDown={(ev) =>
                      onHandlePointerDown(ev, selected.id, "a")
                    }
                  />
                  <Handle
                    style={toPct(selected.b)}
                    onPointerDown={(ev) =>
                      onHandlePointerDown(ev, selected.id, "b")
                    }
                  />
                </>
              )}
              {selected.kind === "arrow" && (
                <>
                  <Handle
                    style={toPct(selected.tail)}
                    onPointerDown={(ev) =>
                      onHandlePointerDown(ev, selected.id, "tail")
                    }
                  />
                  <Handle
                    style={toPct(selected.tip)}
                    onPointerDown={(ev) =>
                      onHandlePointerDown(ev, selected.id, "tip")
                    }
                  />
                </>
              )}
              {selected.kind === "circle" && (
                <>
                  <Handle
                    style={toPct(selected.center)}
                    onPointerDown={(ev) =>
                      onHandlePointerDown(ev, selected.id, "center")
                    }
                  />
                  <Handle
                    style={toPct({
                      x: selected.center.x + selected.radius,
                      y: selected.center.y
                    })}
                    onPointerDown={(ev) =>
                      onHandlePointerDown(ev, selected.id, "rim")
                    }
                  />
                </>
              )}
              {selected.kind === "polyline" &&
                selected.points.map((pt, i) => (
                  <Handle
                    key={`v-${i}`}
                    style={toPct(pt)}
                    onPointerDown={(ev) =>
                      onHandlePointerDown(ev, selected.id, `v:${i}`)
                    }
                  />
                ))}
              {selected.kind === "callout" && (
                <>
                  <Handle
                    style={toPct(selected.anchor)}
                    onPointerDown={(ev) =>
                      onHandlePointerDown(ev, selected.id, "anchor")
                    }
                  />
                  <Handle
                    style={toPct(selected.label)}
                    onPointerDown={(ev) =>
                      onHandlePointerDown(ev, selected.id, "label")
                    }
                  />
                </>
              )}
            </div>
          )}
          </div>
        </div>
      </div>

      <div className="annotation-overlay-chrome">
        <div className="annotation-chrome-left">
          <button
            type="button"
            className={`annotation-tool-btn${tool === "erase" ? " is-active" : ""}`}
            aria-pressed={tool === "erase"}
            aria-label="Eraser"
            onClick={() => setTool("erase")}
          >
            <LucideEraserIcon className="annotation-tool-icon" />
          </button>
          <button
            type="button"
            className={`annotation-tool-btn${tool === "draw" ? " is-active" : ""}`}
            aria-pressed={tool === "draw"}
            aria-label="Brush"
            onClick={() => setTool("draw")}
          >
            <LucideBrushIcon className="annotation-tool-icon" />
          </button>
        </div>

        <div className="annotation-chrome-center">
          <button
            type="button"
            className="annotation-tool-btn"
            aria-label="Undo"
            disabled={past.length === 0}
            onClick={undo}
          >
            <LucideUndoIcon />
          </button>
          <button
            type="button"
            className="annotation-chrome-btn annotation-chrome-btn-primary"
            onClick={() => onFinished(annotations)}
          >
            Finished
          </button>
          <button
            type="button"
            className="annotation-tool-btn"
            aria-label="Redo"
            disabled={future.length === 0}
            onClick={redo}
          >
            <LucideRedoIcon />
          </button>
        </div>

        <div className="annotation-chrome-right">
          <div className="annotation-chrome-shapes">
            <button
              type="button"
              className="annotation-tool-btn"
              aria-label="Add arrow"
              onClick={() => spawnShape("arrow")}
            >
              <LucideArrowIcon />
            </button>
            <button
              type="button"
              className="annotation-tool-btn"
              aria-label="Add circle"
              onClick={() => spawnShape("circle")}
            >
              <LucideCircleIcon />
            </button>
            <button
              type="button"
              className="annotation-tool-btn"
              aria-label="Add line"
              onClick={() => spawnShape("line")}
            >
              <LucideLineIcon />
            </button>
            <button
              type="button"
              className="annotation-tool-btn"
              aria-label="Add text note"
              onClick={() => spawnShape("callout")}
            >
              <LucideTypeIcon />
            </button>
          </div>
          <label className="annotation-chrome-switch">
            <span className="annotation-chrome-switch-label">Auto shape</span>
            <button
              type="button"
              role="switch"
              className={`annotation-ctx-toggle${shapeDetect ? " is-on" : ""}`}
              aria-checked={shapeDetect}
              aria-label="Auto shape"
              onClick={() => setShapeDetect((v) => !v)}
            >
              <span className="annotation-ctx-toggle-knob" />
            </button>
          </label>
        </div>
      </div>
    </div>
  );

  return createPortal(ui, document.body);
}

function Handle({
  style,
  onPointerDown
}: {
  style: { left: string; top: string };
  onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      className="annotation-handle"
      style={style}
      aria-label="Resize annotation"
      onPointerDown={onPointerDown}
    />
  );
}

function AnnotationPath({
  ann,
  aspect,
  photoWidth,
  selected
}: {
  ann: PhotoAnnotation;
  aspect: number;
  photoWidth: number;
  selected: boolean;
}) {
  const sw = selected ? 0.0075 : 0.006;
  const common = {
    fill: "none" as const,
    stroke: INK,
    strokeWidth: sw,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const
  };

  if (ann.kind === "freehand" || ann.kind === "polyline") {
    return (
      <polyline
        {...common}
        points={ann.points.map((p) => `${p.x},${p.y}`).join(" ")}
      />
    );
  }
  if (ann.kind === "line") {
    return (
      <line
        {...common}
        x1={ann.a.x}
        y1={ann.a.y}
        x2={ann.b.x}
        y2={ann.b.y}
      />
    );
  }
  if (ann.kind === "circle") {
    return (
      <ellipse
        {...common}
        cx={ann.center.x}
        cy={ann.center.y}
        rx={ann.radius}
        ry={ann.radius / Math.max(aspect, 1e-6)}
      />
    );
  }
  if (ann.kind === "arrow") {
    const head = arrowHeadPoints(ann.tip, ann.tail);
    return (
      <g>
        <line
          {...common}
          x1={ann.tail.x}
          y1={ann.tail.y}
          x2={ann.tip.x}
          y2={ann.tip.y}
        />
        <polyline
          {...common}
          points={`${head.left.x},${head.left.y} ${ann.tip.x},${ann.tip.y} ${head.right.x},${head.right.y}`}
        />
      </g>
    );
  }
  if (ann.kind === "callout") {
    const m = calloutMetrics(ann.text, photoWidth, aspect);
    const attach = calloutAttachPoint(ann.anchor, ann.label, m.tw, m.thY);
    // Text/box are HTML overlays — SVG text stretches under preserveAspectRatio=none.
    return (
      <g>
        <line
          {...common}
          x1={ann.anchor.x}
          y1={ann.anchor.y}
          x2={attach.x}
          y2={attach.y}
        />
        <ellipse
          cx={ann.anchor.x}
          cy={ann.anchor.y}
          rx={0.006}
          ry={0.006 / Math.max(aspect, 1e-6)}
          fill={INK}
          stroke="none"
        />
      </g>
    );
  }
  return null;
}

function CalloutLabel({
  ann,
  editing,
  onLiveChange,
  onCommit
}: {
  ann: Extract<PhotoAnnotation, { kind: "callout" }>;
  editing: boolean;
  onLiveChange: (text: string) => void;
  onCommit: (from: string, to: string) => void;
}) {
  const originRef = useRef(ann.text);
  const style = {
    left: `${ann.label.x * 100}%`,
    top: `${ann.label.y * 100}%`
  };

  if (editing) {
    return (
      <input
        className="annotation-callout-label is-editing"
        value={ann.text}
        maxLength={80}
        size={Math.max(3, (ann.text.trim() || "Note").length)}
        aria-label="Callout note text"
        autoFocus
        onFocus={() => {
          originRef.current = ann.text;
        }}
        onChange={(e) => onLiveChange(e.target.value)}
        onBlur={(e) => onCommit(originRef.current, e.target.value)}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
          e.stopPropagation();
        }}
        style={style}
      />
    );
  }

  return (
    <div className="annotation-callout-label" style={style} aria-hidden>
      {ann.text.trim() || "Note"}
    </div>
  );
}

/** Lucide type — https://lucide.dev/icons/type (ISC) */
function LucideTypeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className="annotation-ctx-icon">
      <path
        d="M4 7V4h16v3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9 20h6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 4v16"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Lucide undo-2 — https://lucide.dev/icons/undo-2 (ISC) */
function LucideUndoIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className="annotation-ctx-icon">
      <path
        d="M9 14 4 9l5-5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Lucide redo-2 — https://lucide.dev/icons/redo-2 (ISC) */
function LucideRedoIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className="annotation-ctx-icon">
      <path
        d="m15 14 5-5-5-5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Lucide brush — https://lucide.dev/icons/brush (ISC) */
function LucideBrushIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={className ?? "annotation-ctx-icon"}
    >
      <path
        d="m11 10 3 3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6.5 21A3.5 3.5 0 1 0 3 17.5a2.62 2.62 0 0 1-.708 1.792A1 1 0 0 0 3 21z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9.969 17.031 21.378 5.624a1 1 0 0 0-3.002-3.002L6.967 14.031"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Lucide eraser — https://lucide.dev/icons/eraser (ISC) */
function LucideEraserIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={className ?? "annotation-ctx-icon"}
    >
      <path
        d="M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.829 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="m5.082 11.09 8.828 8.828"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Lucide arrow-up-right — https://lucide.dev/icons/arrow-up-right (ISC) */
function LucideArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className="annotation-ctx-icon">
      <path
        d="M7 17 17 7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7 7h10v10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Lucide circle — https://lucide.dev/icons/circle (ISC) */
function LucideCircleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className="annotation-ctx-icon">
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}

/** Lucide minus — https://lucide.dev/icons/minus (ISC) */
function LucideLineIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className="annotation-ctx-icon">
      <path
        d="M5 12h14"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
