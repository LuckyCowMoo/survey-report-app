import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent as ReactTouchEvent
} from "react";
import { flushSync } from "react-dom";
import {
  applyCameraZoom,
  captureJpegFromStream,
  getCameraZoomRange,
  isCameraAbortError,
  listVideoCameras,
  loadPreferredCameraId,
  savePreferredCameraId,
  startCamera,
  stopCamera,
  waitCompositorIdle,
  type CameraDeviceInfo
} from "../lib/cameraCapture";
import {
  countMatchedShorthandNotes,
  createFieldNoteShot,
  fieldNotePipTones,
  formatFieldNoteCreated,
  missingFieldNoteChecklist,
  renumberFieldNotes
} from "../lib/fieldNotes";
import {
  requestHeadingPermission,
  subscribeDeviceHeading
} from "../lib/deviceHeading";
import { library } from "../lib/matcher";
import { compositeAnnotationsOntoJpeg } from "../lib/annotationComposite";
import { getImageDims, jpegBytesFromImageFile } from "../lib/imageUtils";
import type { FieldNoteShot, PhotoAnnotation, PhotoCrop } from "../types";
import AnnotationOverlay from "./AnnotationOverlay";
import BrandMark from "./BrandMark";
import {
  DirectionCompass,
  WEATHER_DIRECTIONS,
  weatherIdForHeading,
  weatherNoteForHeading,
  type DirectionCompassHandle
} from "./DirectionCompass";
import FieldNotesFinishSheet from "./FieldNotesFinishSheet";
import FieldNotesNoteField from "./FieldNotesNoteField";
import { useT } from "../lib/i18n";
import TutorialLiveView, {
  type TutorialLiveHandle
} from "./TutorialLiveView";
import TutorialCoach from "./TutorialCoach";
import {
  allows,
  coachFor,
  TUTORIAL_BASELINE_INDEX,
  TUTORIAL_RH_INDEX,
  type TutorialBeat,
  type TutorialEvent
} from "../lib/tutorial/flow";

type Props = {
  shots: FieldNoteShot[];
  onChange: (next: FieldNoteShot[]) => void;
  busy: boolean;
  onSaveInApp: () => void;
  onContinueToReport: () => void;
  onExportDocx: () => void;
  onExportDmsr: () => void;
  /** When true, pip jumps animate through every in-between photo. */
  photoPassThrough?: boolean;
  /** Replace the live camera with the interactive house tutorial. */
  tutorial?: boolean;
  tutorialBeat?: TutorialBeat | null;
  onTutorialEvent?: (event: TutorialEvent) => void;
  onOpenEpc?: () => void;
  /** False while review is showing — keep this tree mounted, pause the camera. */
  active?: boolean;
};

type Mode = "live" | "review" | "retake";

/** Survives iOS photo-picker remounts so we still know new vs replace. */
let pendingPictureTarget: "new" | number = "new";

const SWIPE_MIN_PX = 56;
const SLIDE_MS = 320;
const PIP_PASS_STEP_MS = 140;
const PIP_PASS_MAX_MS = 900;
const RETAKE_HOLD_MS = 2000;
const POST_CAPTURE_SOLID_MS = 1000;
const DELETE_HOLD_MS = 3000;
const ANNOTATE_HOLD_MS = 500;
const ANNOTATE_HOLD_MOVE_PX = 14;
const ZOOM_CSS_MIN = 1;
const ZOOM_CSS_MAX = 4;
const DIAL_START_DEG = 180; // left
const DIAL_END_DEG = 0; // right (upper semicircle, clockwise from left→top→right)

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Enlarge a cover-fit media box without CSS transform (avoids video compositor layers). */
function cssCoverZoomStyle(zoom: number): CSSProperties {
  const z = Math.max(1, zoom);
  if (z <= 1.001) return { width: "100%", height: "100%" };
  const shift = -((z - 1) / 2) * 100;
  return {
    width: `${z * 100}%`,
    height: `${z * 100}%`,
    marginLeft: `${shift}%`,
    marginTop: `${shift}%`
  };
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function FitOneLineButton({
  label,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const btn = btnRef.current;
    const text = textRef.current;
    if (!btn || !text) return;
    const fit = () => {
      text.style.fontSize = "";
      const pad =
        Number.parseFloat(getComputedStyle(btn).paddingLeft) +
        Number.parseFloat(getComputedStyle(btn).paddingRight) +
        4;
      let size = Number.parseFloat(getComputedStyle(text).fontSize);
      while (text.scrollWidth > btn.clientWidth - pad && size > 10) {
        size -= 0.25;
        text.style.fontSize = `${size}px`;
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(btn);
    return () => ro.disconnect();
  }, [label]);

  return (
    <button ref={btnRef} className={className} {...props}>
      <span ref={textRef} className="field-notes-finish-label">
        {label}
      </span>
    </button>
  );
}

function zoomToDialAngle(zoom: number, min: number, max: number) {
  const t = max <= min ? 0 : (zoom - min) / (max - min);
  return DIAL_START_DEG + (DIAL_END_DEG - DIAL_START_DEG) * t;
}

/** atan2 angle in degrees: right=0, top=90, left=180 (upper arc). */
function pointToDialAngle(cx: number, cy: number, x: number, y: number) {
  const rad = Math.atan2(cy - y, x - cx); // invert y so up is positive
  const deg = (rad * 180) / Math.PI; // -180..180, right=0, top=90, left=±180
  if (deg < 0) {
    // Finger slipped below the seam — pick nearest end by screen half.
    return x < cx ? 180 : 0;
  }
  return Math.min(180, deg);
}

function angleToZoomUpper(angleDeg: number, min: number, max: number) {
  // 180 (left/min) → 0 (right/max)
  const t = 1 - angleDeg / 180;
  return min + (max - min) * clamp(t, 0, 1);
}

function CompassIcon() {
  return (
    <svg
      className="field-notes-compass-icon"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
      <polygon
        fill="currentColor"
        points="12 4 14.2 12 12 11.2 9.8 12"
      />
      <polygon
        fill="currentColor"
        fillOpacity="0.35"
        points="12 20 9.8 12 12 12.8 14.2 12"
      />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" />
    </svg>
  );
}

function CameraLensIcon() {
  return (
    <svg
      className="field-notes-lens-icon"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <path
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z"
      />
      <path
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM18.75 10.5h.008v.008h-.008V10.5Z"
      />
    </svg>
  );
}

export default function FieldNotesScreen({
  shots,
  onChange,
  busy,
  onSaveInApp,
  onContinueToReport,
  onExportDocx,
  onExportDmsr,
  photoPassThrough = false,
  tutorial = false,
  tutorialBeat = null,
  onTutorialEvent,
  onOpenEpc,
  active = true
}: Props) {
  const t = useT();
  const [index, setIndex] = useState(() => shots.length);
  const [mode, setMode] = useState<Mode>("live");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraLoading, setCameraLoading] = useState(() => !tutorial);
  const [capturing, setCapturing] = useState(false);
  const [showSave, setShowSave] = useState(false);
  const [cameras, setCameras] = useState<CameraDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState<string | null>(() =>
    loadPreferredCameraId()
  );
  const [createdDraft, setCreatedDraft] = useState(() =>
    formatFieldNoteCreated()
  );
  const [dragX, setDragX] = useState(0);
  const [sliding, setSliding] = useState(false);
  const [slideMs, setSlideMs] = useState(SLIDE_MS);
  const [zoom, setZoom] = useState(1);
  const [zoomMin, setZoomMin] = useState(ZOOM_CSS_MIN);
  const [zoomMax, setZoomMax] = useState(ZOOM_CSS_MAX);
  const [hwZoom, setHwZoom] = useState(false);
  const [pulseKey, setPulseKey] = useState(0);
  const [flashKey, setFlashKey] = useState(0);
  const [holdingRetake, setHoldingRetake] = useState(false);
  /** Keep shutter opaque briefly after capture before fading to retake. */
  const [shutterSolid, setShutterSolid] = useState(false);
  const [capturePulse, setCapturePulse] = useState(false);
  const [pulseInward, setPulseInward] = useState(false);
  const [deleteHolding, setDeleteHolding] = useState(false);
  const [deleteHoldProgress, setDeleteHoldProgress] = useState(0);
  const [showDeleteHint, setShowDeleteHint] = useState(false);
  const [annotating, setAnnotating] = useState(false);
  const [annotateUrl, setAnnotateUrl] = useState<string | null>(null);
  const [importingPictures, setImportingPictures] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [tutorialCanCapture, setTutorialCanCapture] = useState(false);
  const [compassOpen, setCompassOpen] = useState(false);
  const [headingDeg, setHeadingDeg] = useState<number | null>(null);
  const [headingError, setHeadingError] = useState<string | null>(null);
  const [gridView, setGridView] = useState(false);
  const [walkToken, setWalkToken] = useState(0);
  const [gutterChapter, setGutterChapter] = useState(false);
  const [keepNoteField, setKeepNoteField] = useState(false);
  const [previewParked, setPreviewParked] = useState(false);
  const liveGenRef = useRef(0);
  const noteIdleRef = useRef(0);
  const onTutorialEventRef = useRef(onTutorialEvent);
  onTutorialEventRef.current = onTutorialEvent;

  const videoRef = useRef<HTMLVideoElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const previewRafRef = useRef(0);
  const paintPreviewRef = useRef<() => void>(() => {});
  const tutorialViewRef = useRef<TutorialLiveHandle>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const importingRef = useRef(false);
  const shotsRef = useRef(shots);
  shotsRef.current = shots;
  const createdDraftRef = useRef(createdDraft);
  createdDraftRef.current = createdDraft;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const streamRef = useRef<MediaStream | null>(null);
  const cameraGenRef = useRef(0);
  const shutterWrapRef = useRef<HTMLDivElement>(null);
  const cameraIdRef = useRef(cameraId);
  cameraIdRef.current = cameraId;
  const indexRef = useRef(index);
  indexRef.current = index;
  const shotsLenRef = useRef(shots.length);
  shotsLenRef.current = shots.length;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const zoomMinRef = useRef(zoomMin);
  zoomMinRef.current = zoomMin;
  const zoomMaxRef = useRef(zoomMax);
  zoomMaxRef.current = zoomMax;
  const hwZoomRef = useRef(hwZoom);
  hwZoomRef.current = hwZoom;
  const shouldRunCameraRef = useRef(true);
  const swipeRef = useRef<{
    id: number;
    x: number;
    y: number;
    skip: boolean;
  } | null>(null);
  const dialDragRef = useRef(false);
  const pinchRef = useRef<{ dist: number; zoom: number } | null>(null);
  const holdArmedRef = useRef(false);
  const holdJustFinishedRef = useRef(false);
  const holdRafRef = useRef(0);
  const holdFillRef = useRef<HTMLSpanElement>(null);
  const shutterBtnRef = useRef<HTMLButtonElement>(null);
  const slideTimerRef = useRef(0);
  const deleteHoldRafRef = useRef(0);
  const deleteHoldArmedRef = useRef(false);
  const deleteHintTimerRef = useRef(0);
  const annotateHoldTimerRef = useRef<number | null>(null);
  const thumbUrlsRef = useRef<string[]>([]);
  const thumbCacheRef = useRef<Map<string, { sig: string; url: string }>>(
    new Map()
  );
  const [thumbUrls, setThumbUrls] = useState<string[]>([]);
  const compassRef = useRef<DirectionCompassHandle>(null);
  const compassOpenRef = useRef(false);
  compassOpenRef.current = compassOpen;

  const maxIndex = shots.length;
  const safeIndex = Math.max(0, Math.min(index, maxIndex));
  const current = safeIndex < shots.length ? shots[safeIndex] : null;
  const isEmptySlot = current === null;
  const showLive = isEmptySlot || mode === "retake";
  const shouldRunCamera = active && showLive && !gridView;
  shouldRunCameraRef.current = shouldRunCamera;
  const tutorialAllows = (action: Parameters<typeof allows>[1]) =>
    !tutorial || (tutorialBeat != null && allows(tutorialBeat, action));

  const canCapture = gridView
    ? false
    : compassOpen
    ? !busy && !capturing && tutorialAllows("shutter")
    : tutorial
      ? showLive &&
        !busy &&
        !capturing &&
        tutorialCanCapture &&
        tutorialAllows("shutter")
      : showLive && !busy && !capturing && !cameraError && !cameraLoading;
  /** Visual translucent retake look — keep during slide so it doesn’t flash opaque. */
  const shutterRetakeLook =
    mode === "review" && !!current && !shutterSolid;
  const canHoldRetake =
    !tutorial && shutterRetakeLook && !busy && !capturing && !sliding;

  const matchedCount = useMemo(
    () => countMatchedShorthandNotes(shots),
    [shots]
  );
  const missingChecklist = useMemo(
    () => missingFieldNoteChecklist(shots),
    [shots]
  );
  const pipTones = useMemo(() => fieldNotePipTones(shots), [shots]);
  const weatherParagraphs = useMemo(
    () => library.photoParagraphs.filter((p) => p.group === "Weather / orientation"),
    []
  );
  const lastFacingIdRef = useRef<string | null>(null);
  const facingId =
    headingDeg != null
      ? weatherIdForHeading(headingDeg, lastFacingIdRef.current)
      : null;
  if (facingId) lastFacingIdRef.current = facingId;
  const compassFacing =
    facingId
      ? weatherParagraphs.find((p) => p.id === facingId)?.topic ?? null
      : null;
  const photoPassThroughRef = useRef(photoPassThrough);
  photoPassThroughRef.current = photoPassThrough;

  const stopStream = useCallback(() => {
    cameraGenRef.current += 1;
    stopCamera(streamRef.current);
    streamRef.current = null;
    const el = videoRef.current;
    if (el) el.srcObject = null;
  }, []);

  const applyCameraRunning = useCallback((running: boolean) => {
    const stream = streamRef.current;
    if (stream) {
      for (const track of stream.getVideoTracks()) {
        track.enabled = running;
      }
    }
    const el = videoRef.current;
    if (!el) return;
    if (running && stream) {
      if (el.srcObject !== stream) el.srcObject = stream;
      void el.play().catch(() => {});
    } else {
      el.pause();
    }
  }, []);

  const refreshCameras = useCallback(async () => {
    try {
      const list = await listVideoCameras();
      setCameras(list);
      return list;
    } catch {
      return [] as CameraDeviceInfo[];
    }
  }, []);

  const syncZoomRange = useCallback((stream: MediaStream | null) => {
    const range = getCameraZoomRange(stream);
    if (range) {
      setHwZoom(true);
      setZoomMin(range.min);
      setZoomMax(range.max);
      setZoom((z) => clamp(z, range.min, range.max));
    } else {
      setHwZoom(false);
      setZoomMin(ZOOM_CSS_MIN);
      setZoomMax(ZOOM_CSS_MAX);
      setZoom((z) => clamp(z, ZOOM_CSS_MIN, ZOOM_CSS_MAX));
    }
  }, []);

  const ensureCamera = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    const gen = ++cameraGenRef.current;
    setCameraLoading(true);
    setCameraError(null);
    try {
      stopCamera(streamRef.current);
      streamRef.current = null;
      const stream = await startCamera(video, cameraIdRef.current);
      if (gen !== cameraGenRef.current) {
        stopCamera(stream);
        return;
      }
      streamRef.current = stream;
      applyCameraRunning(shouldRunCameraRef.current);
      syncZoomRange(stream);
      const list = await refreshCameras();
      if (gen !== cameraGenRef.current) return;
      const trackId = stream.getVideoTracks()[0]?.getSettings().deviceId;
      if (trackId) {
        const known = list.some((c) => c.deviceId === trackId);
        if (known && trackId !== cameraIdRef.current) {
          setCameraId(trackId);
          savePreferredCameraId(trackId);
        }
      }
      if (hwZoomRef.current || getCameraZoomRange(stream)) {
        void applyCameraZoom(stream, zoomRef.current);
      }
      setCameraError(null);
      setCameraLoading(false);
    } catch (err) {
      if (gen !== cameraGenRef.current) return;
      if (isCameraAbortError(err)) {
        const v = videoRef.current;
        if (v && v.srcObject && (!v.paused || v.readyState >= 2)) {
          setCameraError(null);
          setCameraLoading(false);
        }
        return;
      }
      setCameraError(err instanceof Error ? err.message : String(err));
      setCameraLoading(false);
    }
  }, [applyCameraRunning, refreshCameras, syncZoomRange]);

  useEffect(() => {
    if (tutorial) {
      setCameraLoading(false);
      return;
    }
    if (!active) {
      stopStream();
      return;
    }
    if (streamRef.current) {
      applyCameraRunning(shouldRunCameraRef.current);
      return;
    }
    let cancelled = false;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        if (!cancelled) void ensureCamera();
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [active, applyCameraRunning, cameraId, ensureCamera, tutorial]);

  useEffect(() => () => stopStream(), [stopStream]);

  useEffect(() => {
    applyCameraRunning(shouldRunCamera);
  }, [shouldRunCamera, applyCameraRunning]);

  const parkLivePreview = useCallback(async (releaseStream = false) => {
    liveGenRef.current += 1;
    if (previewRafRef.current) {
      cancelAnimationFrame(previewRafRef.current);
      previewRafRef.current = 0;
    }
    const canvas = previewRef.current;
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    flushSync(() => setPreviewParked(true));
    applyCameraRunning(false);
    if (releaseStream) stopStream();
    await waitCompositorIdle();
  }, [applyCameraRunning, stopStream]);

  paintPreviewRef.current = () => {
    const video = videoRef.current;
    const canvas = previewRef.current;
    if (!video || !canvas || video.readyState < 2) return;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (vw < 2 || vh < 2) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const cw = Math.max(1, Math.round(rect.width * dpr));
    const ch = Math.max(1, Math.round(rect.height * dpr));
    if (cw < 2 || ch < 2) return;
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    const ctx = canvas.getContext("2d", {
      alpha: false,
      willReadFrequently: true
    });
    if (!ctx) return;
    const zoom = hwZoomRef.current ? 1 : Math.max(1, zoomRef.current);
    const scale = Math.max(cw / vw, ch / vh) * zoom;
    const dw = vw * scale;
    const dh = vh * scale;
    ctx.drawImage(video, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
  };

  useEffect(() => {
    if (tutorial || !shouldRunCamera || previewParked) {
      if (previewRafRef.current) {
        cancelAnimationFrame(previewRafRef.current);
        previewRafRef.current = 0;
      }
      return;
    }
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        let last = 0;
        const tick = (now: number) => {
          if (now - last >= 32) {
            last = now;
            paintPreviewRef.current();
          }
          previewRafRef.current = requestAnimationFrame(tick);
        };
        previewRafRef.current = requestAnimationFrame(tick);
      });
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
      cancelAnimationFrame(previewRafRef.current);
      previewRafRef.current = 0;
    };
  }, [tutorial, shouldRunCamera, previewParked]);

  useEffect(() => {
    if (tutorial || !shouldRunCamera) {
      liveGenRef.current += 1;
      setPreviewParked(true);
      return;
    }
    const gen = liveGenRef.current;
    let cancelled = false;
    void waitCompositorIdle().then(() => {
      if (!cancelled && gen === liveGenRef.current) setPreviewParked(false);
    });
    return () => {
      cancelled = true;
    };
  }, [tutorial, shouldRunCamera]);

  useEffect(() => {
    if (!current && shots.length === 0) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setKeepNoteField(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [current, shots.length]);

  useEffect(() => {
    let cancelled = false;
    const cache = thumbCacheRef.current;
    void (async () => {
      const next: string[] = [];
      const keep = new Set<string>();
      for (const s of shots) {
        const sig = `${s.image.byteLength}:${s.annotations?.length ?? 0}:${
          s.photoCrop
            ? `${s.photoCrop.left},${s.photoCrop.top},${s.photoCrop.right},${s.photoCrop.bottom}`
            : ""
        }`;
        const hit = cache.get(s.id);
        if (hit && hit.sig === sig) {
          next.push(hit.url);
          keep.add(s.id);
          continue;
        }
        const bytes = await compositeAnnotationsOntoJpeg(
          s.image,
          s.annotations,
          s.photoCrop
        );
        if (cancelled) return;
        const copy = new Uint8Array(bytes.byteLength);
        copy.set(bytes);
        const url = URL.createObjectURL(new Blob([copy], { type: "image/jpeg" }));
        if (hit) URL.revokeObjectURL(hit.url);
        cache.set(s.id, { sig, url });
        keep.add(s.id);
        next.push(url);
      }
      for (const [id, ent] of [...cache.entries()]) {
        if (!keep.has(id)) {
          URL.revokeObjectURL(ent.url);
          cache.delete(id);
        }
      }
      if (cancelled) return;
      thumbUrlsRef.current = next;
      setThumbUrls(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [shots]);

  useEffect(
    () => () => {
      for (const ent of thumbCacheRef.current.values()) {
        URL.revokeObjectURL(ent.url);
      }
      thumbCacheRef.current.clear();
    },
    []
  );

  // After capture: stay solid, then fade to translucent retake.
  useEffect(() => {
    if (!shutterSolid) return;
    const timer = window.setTimeout(() => {
      setShutterSolid(false);
    }, POST_CAPTURE_SOLID_MS);
    return () => window.clearTimeout(timer);
  }, [shutterSolid]);

  useEffect(() => {
    if (index > shots.length) setIndex(shots.length);
  }, [shots.length, index]);

  useEffect(() => {
    if (!compassOpen) {
      setHeadingDeg(null);
      return;
    }
    return subscribeDeviceHeading(setHeadingDeg);
  }, [compassOpen]);

  useEffect(() => {
    if (!isEmptySlot && compassOpen) setCompassOpen(false);
  }, [isEmptySlot, compassOpen]);

  useEffect(
    () => () => {
      if (slideTimerRef.current) window.clearTimeout(slideTimerRef.current);
      if (holdRafRef.current) cancelAnimationFrame(holdRafRef.current);
      if (deleteHoldRafRef.current)
        cancelAnimationFrame(deleteHoldRafRef.current);
      if (deleteHintTimerRef.current)
        window.clearTimeout(deleteHintTimerRef.current);
      if (annotateHoldTimerRef.current != null)
        window.clearTimeout(annotateHoldTimerRef.current);
    },
    []
  );

  const setZoomClamped = useCallback(
    (next: number) => {
      const z = clamp(next, zoomMinRef.current, zoomMaxRef.current);
      setZoom(z);
      if (hwZoomRef.current) {
        void applyCameraZoom(streamRef.current, z);
      }
    },
    []
  );

  const triggerPulse = useCallback((inward = false) => {
    if (prefersReducedMotion()) return;
    setPulseInward(inward);
    setPulseKey((k) => k + 1);
  }, []);

  const triggerFlash = useCallback(() => {
    if (prefersReducedMotion()) return;
    setFlashKey((k) => k + 1);
  }, []);

  const settleTo = useCallback((nextIndex: number, durationMs = SLIDE_MS) => {
    const clamped = Math.max(0, Math.min(shotsLenRef.current, nextIndex));
    setDragX(0);
    setIndex(clamped);
    if (clamped >= shotsLenRef.current) setMode("live");
    else setMode("review");
    setHoldingRetake(false);
    setShutterSolid(false);
    if (prefersReducedMotion()) {
      setSliding(false);
      return;
    }
    setSlideMs(durationMs);
    setSliding(true);
    if (slideTimerRef.current) window.clearTimeout(slideTimerRef.current);
    slideTimerRef.current = window.setTimeout(() => {
      setSliding(false);
      slideTimerRef.current = 0;
    }, durationMs);
  }, []);

  useEffect(() => {
    if (!tutorial) return;
    if (headingDeg == null) setHeadingDeg(0);
  }, [tutorial, headingDeg]);

  useEffect(() => {
    if (!tutorial || tutorialBeat !== "walking") return;
    settleTo(shotsLenRef.current);
    const t = window.setTimeout(() => setWalkToken((n) => n + 1), SLIDE_MS + 60);
    return () => window.clearTimeout(t);
  }, [tutorial, tutorialBeat, settleTo]);

  useEffect(() => {
    if (!tutorial || !tutorialBeat) return;
    if (tutorialBeat === "typeRh" && shots.length > TUTORIAL_RH_INDEX) {
      settleTo(TUTORIAL_RH_INDEX);
    } else if (
      tutorialBeat === "typeBaseline" &&
      shots.length > TUTORIAL_BASELINE_INDEX
    ) {
      settleTo(TUTORIAL_BASELINE_INDEX);
    } else if (tutorialBeat === "summary" || tutorialBeat === "continueDoc") {
      settleTo(shots.length);
    }
  }, [tutorial, tutorialBeat, shots.length, settleTo]);

  const jumpToPip = useCallback(
    (target: number) => {
      if (tutorial) return;
      if (busy || capturing || sliding || holdingRetake || annotating) return;
      setGridView(false);
      const from = indexRef.current;
      const max = shotsLenRef.current;
      const clamped = Math.max(0, Math.min(max, target));
      if (clamped === from) return;

      const span = Math.abs(clamped - from);
      const passThrough = photoPassThroughRef.current;

      if (passThrough || span <= 1 || prefersReducedMotion()) {
        const ms =
          passThrough && span > 1
            ? Math.min(
                PIP_PASS_MAX_MS,
                Math.max(SLIDE_MS, PIP_PASS_STEP_MS * span)
              )
            : SLIDE_MS;
        settleTo(clamped, ms);
        return;
      }

      // Direct jump: target slides in from the side, skipping in-betweens.
      const dir = clamped > from ? 1 : -1;
      const panel =
        shutterWrapRef.current?.parentElement?.querySelector(
          ".field-notes-media-viewport"
        ) as HTMLElement | null;
      const width = panel?.clientWidth || window.innerWidth;

      if (slideTimerRef.current) window.clearTimeout(slideTimerRef.current);
      setSliding(false);
      setSlideMs(SLIDE_MS);
      setDragX(0);
      setIndex(clamped);
      if (clamped >= max) setMode("live");
      else setMode("review");
      setHoldingRetake(false);
      setShutterSolid(false);

      requestAnimationFrame(() => {
        setDragX(dir * width);
        requestAnimationFrame(() => {
          setSliding(true);
          setDragX(0);
          slideTimerRef.current = window.setTimeout(() => {
            setSliding(false);
            slideTimerRef.current = 0;
          }, SLIDE_MS);
        });
      });
    },
    [annotating, busy, capturing, holdingRetake, settleTo, sliding, tutorial]
  );

  const cycleCamera = async () => {
    if (busy || capturing) return;
    let list = cameras;
    if (list.length < 2) list = await refreshCameras();
    if (list.length < 2) {
      await ensureCamera();
      return;
    }
    const cur = cameraIdRef.current;
    const at = Math.max(0, list.findIndex((c) => c.deviceId === cur));
    const next = list[(at + 1) % list.length];
    if (!next) return;
    setCameraId(next.deviceId);
    savePreferredCameraId(next.deviceId);
  };

  const updateShot = (shotIndex: number, patch: Partial<FieldNoteShot>) => {
    if (tutorial && patch.note != null && !tutorialAllows("notes")) return;
    onChange(shots.map((s, i) => (i === shotIndex ? { ...s, ...patch } : s)));
    if (tutorial && patch.note != null) {
      onTutorialEventRef.current?.({ type: "note", value: patch.note });
      window.clearTimeout(noteIdleRef.current);
      noteIdleRef.current = window.setTimeout(() => {
        if (patch.note && patch.note.trim()) {
          onTutorialEventRef.current?.({ type: "noteIdle" });
        }
      }, 1600);
    }
  };

  const paintHoldFill = (p: number) => {
    const fill = holdFillRef.current;
    if (!fill) return;
    const deg = clamp(p, 0, 1) * 180;
    fill.style.opacity = p > 0 ? "1" : "0";
    fill.style.background = `conic-gradient(from 270deg at 50% 50%, var(--brand) 0deg, var(--brand) ${deg}deg, transparent ${deg}deg)`;
  };

  const takePhoto = async () => {
    if (!canCapture) return;
    const focused = document.activeElement;
    if (focused instanceof HTMLElement) focused.blur();
    setCapturing(true);
    try {
      const hotId = compassRef.current?.hotId();
      const fromHot = WEATHER_DIRECTIONS.find((d) => d.id === hotId)?.note;
      const compassNote =
        fromHot ??
        (headingDeg != null ? weatherNoteForHeading(headingDeg) : "north facing");
      const bytes = compassOpen
        ? await compassRef.current!.captureJpeg()
        : tutorial
          ? await (async () => {
              const view = tutorialViewRef.current;
              if (!view) throw new Error("Tutorial viewfinder is not ready yet.");
              return view.captureJpeg();
            })()
          : await (async () => {
              if (!streamRef.current) {
                await ensureCamera();
              }
              if (!streamRef.current) {
                throw new Error(t("fieldNotes.cameraNotReady"));
              }
              return captureJpegFromStream(streamRef.current, videoRef.current);
            })();
      await parkLivePreview();
      triggerPulse();
      triggerFlash();
      setCapturePulse(true);
      window.setTimeout(() => setCapturePulse(false), 450);
      if (mode === "retake" && current && !compassOpen) {
        onChange(
          shots.map((s, i) =>
            i === safeIndex
              ? {
                  ...s,
                  image: bytes,
                  imageName: `image${s.number}.jpeg`,
                  created: s.created || createdDraft,
                  annotations: undefined
                }
              : s
          )
        );
        setMode("review");
      } else {
        const shot = createFieldNoteShot(bytes, {
          imageName: `image${shots.length + 1}.jpeg`,
          created: createdDraft || formatFieldNoteCreated(),
          note: compassOpen ? compassNote : undefined
        });
        const next = renumberFieldNotes([...shots, shot]);
        onChange(next);
        setIndex(next.length - 1);
        setMode("review");
        setDragX(0);
        setCompassOpen(false);
      }
      setShutterSolid(true);
      onTutorialEventRef.current?.({ type: "photo" });
    } catch (err) {
      setCameraError(err instanceof Error ? err.message : String(err));
      if (shouldRunCameraRef.current) setPreviewParked(false);
    } finally {
      setCapturing(false);
    }
  };

  const applyPictures = useCallback(async (files: File[]) => {
    if (!files.length || importingRef.current) return;
    importingRef.current = true;
    setImportingPictures(true);
    setImportError(null);
    try {
      await parkLivePreview();
      const currentShots = shotsRef.current;
      const target = pendingPictureTarget;
      const replacing =
        typeof target === "number" && target < currentShots.length;
      const i = replacing ? target : currentShots.length;
      const created = createdDraftRef.current || formatFieldNoteCreated();

      if (replacing) {
        const bytes = await jpegBytesFromImageFile(files[0]!);
        onChangeRef.current(
          currentShots.map((s, idx) =>
            idx === i
              ? {
                  ...s,
                  image: bytes,
                  imageName: s.imageName || `image${s.number}.jpeg`,
                  annotations: undefined
                }
              : s
          )
        );
        setMode("review");
      } else {
        const added: FieldNoteShot[] = [];
        for (const file of files) {
          const bytes = await jpegBytesFromImageFile(file);
          added.push(
            createFieldNoteShot(bytes, {
              imageName: `image${currentShots.length + added.length + 1}.jpeg`,
              created
            })
          );
        }
        const next = renumberFieldNotes([...currentShots, ...added]);
        onChangeRef.current(next);
        setIndex(currentShots.length);
        setMode("review");
        setDragX(0);
      }
    } catch (err) {
      setImportError(
        err instanceof Error ? err.message : t("fieldNotes.couldNotAdd")
      );
    } finally {
      importingRef.current = false;
      setImportingPictures(false);
    }
  }, [parkLivePreview, t]);

  const cancelHold = useCallback(() => {
    holdArmedRef.current = false;
    setHoldingRetake(false);
    if (holdRafRef.current) {
      cancelAnimationFrame(holdRafRef.current);
      holdRafRef.current = 0;
    }
    paintHoldFill(0);
  }, []);

  const completeHoldRetake = useCallback(() => {
    holdArmedRef.current = false;
    holdJustFinishedRef.current = true;
    setHoldingRetake(false);
    if (holdRafRef.current) {
      cancelAnimationFrame(holdRafRef.current);
      holdRafRef.current = 0;
    }
    paintHoldFill(1);
    triggerPulse(true);
    setMode("retake");
    window.setTimeout(() => paintHoldFill(0), 120);
  }, [triggerPulse]);

  const onShutterPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if (canHoldRetake) {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      holdArmedRef.current = true;
      holdJustFinishedRef.current = false;
      if (prefersReducedMotion()) {
        completeHoldRetake();
        return;
      }
      setHoldingRetake(true);
      paintHoldFill(0);
      const start = performance.now();
      const tick = (now: number) => {
        if (!holdArmedRef.current) return;
        const p = clamp((now - start) / RETAKE_HOLD_MS, 0, 1);
        paintHoldFill(p);
        if (p >= 1) {
          completeHoldRetake();
          return;
        }
        holdRafRef.current = requestAnimationFrame(tick);
      };
      holdRafRef.current = requestAnimationFrame(tick);
      return;
    }
  };

  const onShutterPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (holdJustFinishedRef.current) {
      holdJustFinishedRef.current = false;
      return;
    }
    if (holdArmedRef.current) {
      cancelHold();
      return;
    }
    if (canCapture) {
      e.preventDefault();
      void takePhoto();
    }
  };

  const deleteCurrent = () => {
    if (!current) return;
    const next = renumberFieldNotes(shots.filter((_, i) => i !== safeIndex));
    onChange(next);
    setShowDeleteHint(false);
    setDeleteHolding(false);
    setDeleteHoldProgress(0);
    if (next.length === 0) {
      settleTo(0);
      setMode("live");
    } else {
      settleTo(Math.min(safeIndex, next.length - 1));
    }
  };

  const toggleCompass = async () => {
    if (busy || capturing || !isEmptySlot) return;
    if (tutorial && !tutorialAllows("compass")) return;
    if (compassOpen) {
      setCompassOpen(false);
      setHeadingError(null);
      return;
    }
    if (!tutorial) {
      const ok = await requestHeadingPermission();
      if (!ok) {
        setHeadingError(t("fieldNotes.compassAllow"));
      } else {
        setHeadingError(null);
      }
    } else {
      setHeadingError(null);
      if (headingDeg == null) setHeadingDeg(0);
    }
    setCompassOpen(true);
    onTutorialEventRef.current?.({ type: "compassOpen" });
  };

  const openGridNote = (i: number) => {
    setGridView(false);
    jumpToPip(i);
  };

  const cancelDeleteHold = (showHint: boolean) => {
    deleteHoldArmedRef.current = false;
    setDeleteHolding(false);
    setDeleteHoldProgress(0);
    if (deleteHoldRafRef.current) {
      cancelAnimationFrame(deleteHoldRafRef.current);
      deleteHoldRafRef.current = 0;
    }
    if (showHint) {
      setShowDeleteHint(true);
      if (deleteHintTimerRef.current)
        window.clearTimeout(deleteHintTimerRef.current);
      deleteHintTimerRef.current = window.setTimeout(() => {
        setShowDeleteHint(false);
        deleteHintTimerRef.current = 0;
      }, 2200);
    }
  };

  const onDeletePointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!current || busy || isEmptySlot) return;
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    deleteHoldArmedRef.current = true;
    setDeleteHolding(true);
    setShowDeleteHint(false);
    setDeleteHoldProgress(0);
    const start = performance.now();
    const tick = (now: number) => {
      if (!deleteHoldArmedRef.current) return;
      const p = clamp((now - start) / DELETE_HOLD_MS, 0, 1);
      setDeleteHoldProgress(p);
      if (p >= 1) {
        deleteHoldArmedRef.current = false;
        setDeleteHolding(false);
        setDeleteHoldProgress(0);
        deleteCurrent();
        return;
      }
      deleteHoldRafRef.current = requestAnimationFrame(tick);
    };
    deleteHoldRafRef.current = requestAnimationFrame(tick);
  };

  const onDeletePointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (!deleteHoldArmedRef.current) return;
    cancelDeleteHold(true);
  };

  const updateZoomFromClientPoint = (clientX: number, clientY: number) => {
    const wrap = shutterWrapRef.current;
    if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height; // dial center at flat bottom of D
    const angle = pointToDialAngle(cx, cy, clientX, clientY);
    setZoomClamped(angleToZoomUpper(angle, zoomMinRef.current, zoomMaxRef.current));
  };

  const onDialPointerDown = (e: ReactPointerEvent) => {
    if (busy || capturing) return;
    e.stopPropagation();
    e.preventDefault();
    dialDragRef.current = true;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    updateZoomFromClientPoint(e.clientX, e.clientY);
  };

  const onDialPointerMove = (e: ReactPointerEvent) => {
    if (!dialDragRef.current) return;
    e.stopPropagation();
    updateZoomFromClientPoint(e.clientX, e.clientY);
  };

  const onDialPointerUp = (e: ReactPointerEvent) => {
    if (!dialDragRef.current) return;
    dialDragRef.current = false;
    e.stopPropagation();
  };

  const onTouchStartPinch = (e: ReactTouchEvent) => {
    if (annotating) return;
    if (e.touches.length === 2) {
      swipeRef.current = null;
      const a = e.touches[0];
      const b = e.touches[1];
      if (!a || !b) return;
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      pinchRef.current = { dist, zoom: zoomRef.current };
    }
  };

  const onTouchMovePinch = (e: ReactTouchEvent) => {
    if (annotating || compassOpen || gridView) return;
    const pinch = pinchRef.current;
    if (!pinch || e.touches.length !== 2) return;
    const a = e.touches[0];
    const b = e.touches[1];
    if (!a || !b) return;
    e.preventDefault();
    const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    if (pinch.dist < 1) return;
    const scale = dist / pinch.dist;
    const next = pinch.zoom * scale;
    if (next < zoomMinRef.current * 0.82 && shotsRef.current.length > 0) {
      if (tutorial) {
        pinchRef.current = null;
        setZoomClamped(zoomMinRef.current);
        return;
      }
      pinchRef.current = null;
      setZoomClamped(zoomMinRef.current);
      setGridView(true);
      return;
    }
    setZoomClamped(next);
  };

  const onTouchEndPinch = () => {
    if (pinchRef.current) pinchRef.current = null;
  };

  const openAnnotate = () => {
    if (!current || busy || capturing || annotating) return;
    if (tutorial && !tutorialAllows("annotate") && !tutorialAllows("draw")) return;
    swipeRef.current = null;
    setDragX(0);
    const copy = new Uint8Array(current.image.byteLength);
    copy.set(current.image);
    const url = URL.createObjectURL(new Blob([copy], { type: "image/jpeg" }));
    setAnnotateUrl(url);
    setAnnotating(true);
    onTutorialEventRef.current?.({ type: "annotateOpen" });
  };

  const clearAnnotateHold = () => {
    if (annotateHoldTimerRef.current != null) {
      window.clearTimeout(annotateHoldTimerRef.current);
      annotateHoldTimerRef.current = null;
    }
  };

  const onSwipeDown = (e: ReactPointerEvent) => {
    if (tutorial && !tutorialAllows("swipeRight")) return;
    if (annotating || gridView || compassOpen) return;
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if (sliding || busy || capturing || holdingRetake || dialDragRef.current)
      return;
    const t = e.target;
    if (
      t instanceof Element &&
      t.closest(
        "button,a,label,select,textarea,.field-notes-shutter-wrap,.annotation-overlay,.field-notes-lens-btn,.field-notes-float-btn,.field-notes-notes-footer,.tutorial-live-view,.field-notes-shot-grid,.field-notes-compass-live,.field-notes-note-wrap"
      )
    ) {
      swipeRef.current = null;
      return;
    }
    swipeRef.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      skip: false
    };
    setSliding(false);

    clearAnnotateHold();
    if (
      current &&
      !isEmptySlot &&
      mode === "review" &&
      t instanceof Element &&
      t.closest(".field-notes-camera-panel") &&
      !t.closest("button, a, label, select, .field-notes-shutter-wrap")
    ) {
      annotateHoldTimerRef.current = window.setTimeout(() => {
        annotateHoldTimerRef.current = null;
        swipeRef.current = null;
        setDragX(0);
        openAnnotate();
      }, ANNOTATE_HOLD_MS);
    }
  };

  const onSwipeMove = (e: ReactPointerEvent) => {
    if (annotating) return;
    if (pinchRef.current) return;
    const s = swipeRef.current;
    if (!s || s.id !== e.pointerId || s.skip) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.hypot(dx, dy) > ANNOTATE_HOLD_MOVE_PX) clearAnnotateHold();
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 24) {
      s.skip = true;
      setDragX(0);
      return;
    }
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8) {
      e.preventDefault();
    }
    const at = indexRef.current;
    const max = shotsLenRef.current;
    let nextDx = dx;
    if ((at <= 0 && dx > 0) || (at >= max && dx < 0)) {
      nextDx = dx * 0.28;
    }
    setDragX(nextDx);
  };

  const onSwipeUp = (e: ReactPointerEvent) => {
    if (annotating) {
      swipeRef.current = null;
      setDragX(0);
      return;
    }
    clearAnnotateHold();
    const s = swipeRef.current;
    if (!s || s.id !== e.pointerId) return;
    swipeRef.current = null;
    if (s.skip) {
      setDragX(0);
      return;
    }
    const dx = e.clientX - s.x;
    const at = indexRef.current;
    const max = shotsLenRef.current;
    if (Math.abs(dx) < SWIPE_MIN_PX) {
      setDragX(0);
      setSliding(true);
      if (slideTimerRef.current) window.clearTimeout(slideTimerRef.current);
      slideTimerRef.current = window.setTimeout(() => {
        setSliding(false);
        slideTimerRef.current = 0;
      }, SLIDE_MS);
      return;
    }
    if (dx < 0 && at < max) {
      settleTo(at + 1);
      if (tutorial) {
        onTutorialEventRef.current?.({ type: "swipeRight" });
        if (at + 1 >= max) onTutorialEventRef.current?.({ type: "onEmptySlot" });
      }
    } else if (dx > 0 && at > 0) settleTo(at - 1);
    else {
      setDragX(0);
      setSliding(true);
      if (slideTimerRef.current) window.clearTimeout(slideTimerRef.current);
      slideTimerRef.current = window.setTimeout(() => {
        setSliding(false);
        slideTimerRef.current = 0;
      }, SLIDE_MS);
    }
  };

  const activeCameraLabel =
    cameras.find((c) => c.deviceId === cameraId)?.label ?? t("fieldNotes.camera");

  const indexLabel = isEmptySlot
    ? t("fieldNotes.newNote")
    : `${safeIndex + 1}/${shots.length}`;

  const onPickCamera = (id: string) => {
    setCameraId(id);
    savePreferredCameraId(id);
  };

  const finishAnnotate = (annotations: PhotoAnnotation[], crop?: PhotoCrop) => {
    if (current) {
      updateShot(safeIndex, {
        annotations: annotations.length ? annotations : undefined,
        photoCrop: crop
      });
    }
    setAnnotating(false);
    if (annotateUrl) URL.revokeObjectURL(annotateUrl);
    setAnnotateUrl(null);
    onTutorialEventRef.current?.({ type: "annotateFinished" });
  };

  const annotateDims = current
    ? getImageDims(current.image) ?? { width: 1600, height: 1200 }
    : { width: 1600, height: 1200 };

  const trackStyle: CSSProperties = {
    transform: `translate3d(calc(${-safeIndex * 100}% + ${dragX}px), 0, 0)`,
    transition: sliding
      ? `transform ${slideMs}ms cubic-bezier(0.33, 1, 0.32, 1)`
      : "none"
  };

  const cssZoom = hwZoom ? 1 : zoom;
  const mediaZoomStyle = cssCoverZoomStyle(cssZoom);

  const dialAngle = zoomToDialAngle(zoom, zoomMin, zoomMax);
  const knobRad = (dialAngle * Math.PI) / 180;
  const dialR = 92;
  const knobInner = dialR - 9;
  const knobOuter = dialR + 9;
  const knobLine = {
    x1: 100 + knobInner * Math.cos(knobRad),
    y1: 100 - knobInner * Math.sin(knobRad),
    x2: 100 + knobOuter * Math.cos(knobRad),
    y2: 100 - knobOuter * Math.sin(knobRad)
  };
  // Decorative labels on the outside of the arc (not snap points).
  const zoomNotches = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const z = zoomMin + (zoomMax - zoomMin) * t;
    const ang = (180 - t * 180) * (Math.PI / 180);
    const tickInner = dialR + 3;
    const tickOuter = dialR + 12;
    const labelR = dialR + 22;
    return {
      t,
      label:
        t === 0.5
          ? ""
          : `${Number.isInteger(z) ? z.toFixed(0) : z.toFixed(1)}`,
      x1: 100 + tickInner * Math.cos(ang),
      y1: 100 - tickInner * Math.sin(ang),
      x2: 100 + tickOuter * Math.cos(ang),
      y2: 100 - tickOuter * Math.sin(ang),
      lx: 100 + labelR * Math.cos(ang),
      ly: 100 - labelR * Math.sin(ang)
    };
  });

  const shutterLabel = isEmptySlot
    ? t("fieldNotes.takePhoto")
    : mode === "retake"
      ? t("fieldNotes.takePhoto")
      : t("fieldNotes.retake");

  return (
    <div
      className={`field-notes${tutorial ? " is-tutorial" : ""}`}
      onPointerDownCapture={onSwipeDown}
      onPointerMoveCapture={onSwipeMove}
      onPointerUpCapture={onSwipeUp}
      onPointerCancelCapture={onSwipeUp}
      onTouchStart={onTouchStartPinch}
      onTouchMove={onTouchMovePinch}
      onTouchEnd={onTouchEndPinch}
      onTouchCancel={onTouchEndPinch}
    >
      <input
        id="field-notes-gallery"
        ref={galleryInputRef}
        className="field-notes-gallery-input"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/*"
        onChange={(e) => {
          const input = e.currentTarget;
          const files = input.files ? [...input.files] : [];
          input.value = "";
          if (files.length) void applyPictures(files);
        }}
      />
      <div className="field-notes-stage">
        <div className="field-notes-camera-panel">
          <div className="field-notes-media-viewport">
            <div
              className={`field-notes-media-track${sliding ? " is-sliding" : ""}`}
              style={trackStyle}
            >
              {shots.map((shot, i) => (
                <div key={shot.id} className="field-notes-media-slide">
                  {thumbUrls[i] && (
                    <img
                      className="field-notes-photo"
                      style={mediaZoomStyle}
                      src={thumbUrls[i]}
                      alt={`Field note (${shot.number})`}
                      draggable={false}
                    />
                  )}
                </div>
              ))}
              <div className="field-notes-media-slide field-notes-media-live">
                <div className="field-notes-live-placeholder" />
              </div>
            </div>
            {!tutorial && (
              <div
                className={`field-notes-video-clip${showLive ? "" : " is-behind"}${
                  previewParked || !showLive ? " is-parked" : ""
                }`}
              >
                <video
                  ref={videoRef}
                  className="field-notes-video"
                  width={1}
                  height={1}
                  playsInline
                  muted
                  autoPlay
                />
                {!previewParked && showLive ? (
                  <canvas
                    ref={previewRef}
                    className="field-notes-video-preview"
                    aria-hidden
                  />
                ) : null}
              </div>
            )}
            {tutorial && (showLive || tutorialBeat === "walking") && (
              <TutorialLiveView
                ref={tutorialViewRef}
                chapter={
                  tutorialBeat === "summary" || tutorialBeat === "continueDoc"
                    ? "spawn"
                    : gutterChapter
                      ? "gutter"
                      : "spawn"
                }
                walkToken={tutorialBeat === "walking" ? walkToken : 0}
                freezeLook={
                  tutorialBeat === "summary" || tutorialBeat === "continueDoc"
                }
                hideChrome
                onWalkFinished={() => {
                  setGutterChapter(true);
                  onTutorialEventRef.current?.({ type: "walkDone" });
                }}
                onCanCaptureChange={setTutorialCanCapture}
              />
            )}
            {compassOpen && isEmptySlot && (
              <div className="field-notes-compass-live">
                <div className="field-notes-compass-prompt">
                  <span className="field-notes-compass-arrow" aria-hidden>
                    ↑
                  </span>
                  <p>Point phone away from building</p>
                  {compassFacing ? (
                    <p className="field-notes-compass-facing">{compassFacing}</p>
                  ) : null}
                </div>
                <DirectionCompass
                  ref={compassRef}
                  paragraphs={weatherParagraphs}
                  headingDeg={headingDeg}
                  interactive={false}
                  showHint={false}
                />
                {headingError ? (
                  <p className="field-notes-compass-error">{headingError}</p>
                ) : headingDeg == null ? (
                  <p className="field-notes-compass-error">
                    Waiting for compass…
                  </p>
                ) : null}
              </div>
            )}
            {gridView && (
              <div className="field-notes-shot-grid" role="list">
                {shots.map((shot, i) => (
                  <button
                    key={shot.id}
                    type="button"
                    role="listitem"
                    className={`field-notes-shot-grid-item tone-${pipTones[i] ?? "empty"}`}
                    aria-label={`Open photo ${shot.number}`}
                    onClick={() => openGridNote(i)}
                  >
                    {thumbUrls[i] ? (
                      <img src={thumbUrls[i]} alt="" draggable={false} />
                    ) : null}
                  </button>
                ))}
              </div>
            )}
            <div
              key={flashKey || "flash"}
              className={`field-notes-flash${flashKey ? " is-on" : ""}`}
              aria-hidden
            />
            {showLive && cameraLoading && !cameraError && !tutorial && !compassOpen && (
              <div
                className="field-notes-camera-loading"
                role="status"
                aria-label={t("fieldNotes.startingCamera")}
              >
                <BrandMark
                  className="field-notes-camera-loading-mark"
                  intro
                />
              </div>
            )}
            {showLive && cameraError && !cameraLoading && (
              <div className="field-notes-camera-error" role="alert">
                <p>{cameraError}</p>
                <button
                  type="button"
                  className="btn small"
                  onClick={() => void ensureCamera()}
                >
                  Retry camera
                </button>
              </div>
            )}
          </div>

          <div className="field-notes-cam-float field-notes-cam-float-bottom">
            <div className="field-notes-cam-float-lens">
              {!tutorial && (
                <>
              <label
                htmlFor="field-notes-gallery"
                className={`field-notes-lens-btn field-notes-pictures-btn${
                  capturing || importingPictures ? " is-disabled" : ""
                }`}
                onPointerDown={() => {
                  const len = shotsRef.current.length;
                  const at = Math.max(0, Math.min(indexRef.current, len));
                  pendingPictureTarget = at < len ? at : "new";
                }}
              >
                {importingPictures ? t("fieldNotes.adding") : t("fieldNotes.addFromPictures")}
              </label>
              {cameras.length > 1 ? (
                <label className="field-notes-lens-btn">
                  <CameraLensIcon />
                  <select
                    className="field-notes-lens-select"
                    value={cameraId ?? cameras[0]?.deviceId ?? ""}
                    disabled={busy || capturing}
                    aria-label={t("fieldNotes.chooseCamera")}
                    onChange={(e) => onPickCamera(e.target.value)}
                  >
                    {cameras.map((c) => (
                      <option key={c.deviceId} value={c.deviceId}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <button
                  type="button"
                  className="field-notes-lens-btn"
                  disabled={busy || capturing}
                  title={activeCameraLabel}
                  aria-label={`Choose camera (current: ${activeCameraLabel})`}
                  onClick={() => void cycleCamera()}
                >
                  <CameraLensIcon />
                </button>
              )}
                </>
              )}
            </div>

            <div className="field-notes-cam-float-end">
              <div className="field-notes-cam-float-delete">
                {isEmptySlot && (!tutorial || tutorialAllows("compass")) ? (
                  <button
                    type="button"
                    className={`field-notes-float-btn field-notes-compass-btn${
                      compassOpen ? " is-on" : ""
                    }`}
                    aria-label={
                      compassOpen ? t("fieldNotes.backToCamera") : t("fieldNotes.compass")
                    }
                    aria-pressed={compassOpen}
                    disabled={busy || capturing}
                    onClick={() => void toggleCompass()}
                  >
                    <CompassIcon />
                  </button>
                ) : (
                  <>
                {showDeleteHint && (
                  <span className="field-notes-delete-hint" role="status">
                    Hold to delete
                  </span>
                )}
                <button
                  type="button"
                  className={`field-notes-float-btn field-notes-float-danger${
                    deleteHolding ? " is-delete-holding" : ""
                  }`}
                  style={
                    {
                      "--delete-hold": deleteHoldProgress
                    } as CSSProperties
                  }
                  disabled={!current || busy || isEmptySlot}
                  aria-label={t("fieldNotes.holdToDeletePhoto")}
                  onPointerDown={onDeletePointerDown}
                  onPointerUp={onDeletePointerUp}
                  onPointerCancel={() => cancelDeleteHold(false)}
                  onContextMenu={(e) => e.preventDefault()}
                >
                  <span className="field-notes-delete-fill" aria-hidden />
                  <span className="field-notes-delete-label">Delete</span>
                </button>
                  </>
                )}
              </div>
              <span className="field-notes-index-readout">{indexLabel}</span>
            </div>
          </div>
        </div>

        <div className="field-notes-shutter-wrap" ref={shutterWrapRef}>
          <div className="field-notes-zoom-dial-glass" aria-hidden />
          <div
            key={pulseKey || "pulse"}
            className={`field-notes-shutter-pulses${
              pulseInward ? " is-inward" : ""
            }`}
            aria-hidden
          >
            {pulseKey > 0 && (
              <>
                <span className="field-notes-pulse-ring" />
                <span className="field-notes-pulse-ring" />
                <span className="field-notes-pulse-ring" />
              </>
            )}
          </div>
          <svg
            className="field-notes-zoom-dial"
            viewBox="0 -28 200 128"
            aria-hidden
            onPointerDown={onDialPointerDown}
            onPointerMove={onDialPointerMove}
            onPointerUp={onDialPointerUp}
            onPointerCancel={onDialPointerUp}
          >
            <path
              className="field-notes-zoom-dial-track"
              d="M 8 100 A 92 92 0 0 1 192 100"
              fill="none"
            />
            <path
              className="field-notes-zoom-dial-value"
              d="M 8 100 A 92 92 0 0 1 192 100"
              fill="none"
              pathLength={100}
              strokeDasharray={`${((zoom - zoomMin) / Math.max(0.001, zoomMax - zoomMin)) * 100} 100`}
            />
            {zoomNotches.map((n) => (
              <g key={n.t} className="field-notes-zoom-notch">
                <line x1={n.x1} y1={n.y1} x2={n.x2} y2={n.y2} />
                {n.label ? (
                  <text x={n.lx} y={n.ly} dy="0.35em" textAnchor="middle">
                    {n.label}
                  </text>
                ) : null}
              </g>
            ))}
            <line
              className="field-notes-zoom-dial-knob"
              x1={knobLine.x1}
              y1={knobLine.y1}
              x2={knobLine.x2}
              y2={knobLine.y2}
            />
          </svg>
          <span className="field-notes-zoom-readout" aria-live="polite">
            {zoom.toFixed(1)}
          </span>

          <button
            ref={shutterBtnRef}
            type="button"
            className={`field-notes-shutter${
              shutterRetakeLook ? " is-retake" : ""
            }${holdingRetake ? " is-holding" : ""}${
              capturePulse ? " is-capture-pulse" : ""
            }${shutterSolid ? " is-post-capture" : ""}`}
            aria-label={
              shutterRetakeLook || (mode === "review" && current)
                ? t("fieldNotes.holdToRetake")
                : shutterLabel
            }
            disabled={
              busy ||
              capturing ||
              (!canCapture && !canHoldRetake && !shutterSolid)
            }
            onPointerDown={onShutterPointerDown}
            onPointerUp={onShutterPointerUp}
            onPointerCancel={cancelHold}
            onContextMenu={(e) => e.preventDefault()}
          >
            <span
              ref={holdFillRef}
              className="field-notes-shutter-fill"
              aria-hidden
            />
            <span className="field-notes-shutter-label">{shutterLabel}</span>
          </button>
        </div>

        <div className="field-notes-notes-panel">
          <div
            className="field-notes-pips"
            role="tablist"
            aria-label={t("fieldNotes.fieldNoteSections")}
          >
            {shots.map((shot, i) => {
              const tone = pipTones[i] ?? "empty";
              const current = safeIndex === i;
              return (
                <button
                  key={shot.id}
                  type="button"
                  role="tab"
                  aria-selected={current}
                  aria-label={`Go to photo ${shot.number}`}
                  className={`studio-pip field-notes-pip tone-${tone}${
                    current ? " is-current" : ""
                  }`}
                  disabled={busy || capturing || sliding || tutorial}
                  onClick={() => jumpToPip(i)}
                >
                  <span className="studio-pip-face" aria-hidden />
                </button>
              );
            })}
            <button
              type="button"
              role="tab"
              aria-selected={isEmptySlot}
              aria-label={t("fieldNotes.goToNew")}
              className={`studio-pip field-notes-pip tone-empty${
                isEmptySlot ? " is-current" : ""
              }`}
              disabled={busy || capturing || sliding || tutorial}
              onClick={() => jumpToPip(shots.length)}
            >
              <span className="studio-pip-face" aria-hidden />
            </button>
          </div>
          <div className="field-notes-notes-viewport">
            {keepNoteField ? (
            <div
              className="field-notes-notes-slide"
              inert={isEmptySlot}
              aria-hidden={isEmptySlot}
            >
              <FieldNotesNoteField
                note={current?.note ?? ""}
                tone={pipTones[safeIndex] ?? "empty"}
                disabled={
                  isEmptySlot ||
                  busy ||
                  (tutorial && !tutorialAllows("notes"))
                }
                ariaLabel={
                  current
                    ? `Notes for photo ${current.number}`
                    : t("fieldNotes.notePlaceholder")
                }
                placeholder={
                  tutorial
                    ? tutorialBeat === "typeFront"
                      ? t("fieldNotes.tutorialFront")
                      : tutorialBeat === "typeRh"
                        ? t("fieldNotes.tutorialRh")
                        : tutorialBeat === "typeBaseline"
                          ? t("fieldNotes.tutorialBaseline")
                          : tutorialBeat === "typeTrees"
                            ? t("fieldNotes.tutorialTrees")
                            : t("fieldNotes.notePlaceholder")
                    : t("fieldNotes.notePlaceholder")
                }
                onChange={(note) => {
                  if (current) updateShot(safeIndex, { note });
                }}
              />
            </div>
            ) : null}
            {isEmptySlot ? (
              <div className="field-notes-notes-slide field-notes-notes-summary">
                <div className="field-notes-summary">
                  <div className="field-notes-summary-body">
                    <div className="field-notes-summary-main">
                      <label className="field-notes-created field-notes-summary-date">
                        <input
                          type="text"
                          value={createdDraft}
                          disabled={busy || tutorial}
                          onChange={(e) => setCreatedDraft(e.target.value)}
                          aria-label={t("fieldNotes.createdDate")}
                        />
                      </label>
                      {onOpenEpc && !tutorial && (
                        <button
                          type="button"
                          className="btn small field-notes-epc-btn"
                          disabled={busy}
                          onClick={onOpenEpc}
                        >
                          {t("epc.open")}
                        </button>
                      )}
                      <div className="field-notes-summary-stats" aria-live="polite">
                        <p className="field-notes-matched-line">
                          {t("fieldNotes.notesMatched", {
                            x: "\u0000",
                            y: shots.length
                          })
                            .split("\u0000")
                            .map((part, i, parts) =>
                              i < parts.length - 1 ? (
                                <span key={i}>
                                  {part}
                                  <strong className="field-notes-matched-count">
                                    {matchedCount}
                                  </strong>
                                </span>
                              ) : (
                                <span key={i}>{part}</span>
                              )
                            )}
                        </p>
                      </div>
                      <div className="field-notes-summary-actions">
                        <FitOneLineButton
                          type="button"
                          className="btn big field-notes-finish-inline"
                          disabled={busy || shots.length === 0 || tutorial}
                          label={t("fieldNotes.saveLeave")}
                          onClick={() => {
                            if (tutorial) return;
                            setShowSave(true);
                          }}
                        />
                        <FitOneLineButton
                          type="button"
                          className="btn primary big field-notes-finish-inline"
                          disabled={busy || shots.length === 0 || (tutorial && !tutorialAllows("continueDoc"))}
                          label={t("fieldNotes.continueDoc")}
                          onClick={() => {
                            if (tutorial) {
                              onTutorialEventRef.current?.({ type: "continueDoc" });
                              return;
                            }
                            const focused = document.activeElement;
                            if (focused instanceof HTMLElement) focused.blur();
                            void parkLivePreview(true).then(() =>
                              onContinueToReport()
                            );
                          }}
                        />
                      </div>
                    </div>
                    <div className="field-notes-summary-missing">
                      <h2 className="field-notes-summary-missing-title">
                        {t("fieldNotes.stillNeeded")}
                      </h2>
                      {missingChecklist.length === 0 ? (
                        <p className="field-notes-summary-missing-done">
                          {t("fieldNotes.allNoted")}
                        </p>
                      ) : (
                        <ol className="field-notes-summary-missing-list">
                          {missingChecklist.map((item) => (
                            <li key={item.id}>
                              <span className="field-notes-summary-missing-label">
                                {t(
                                  (
                                    {
                                      front: "checklist.front",
                                      compass: "checklist.compass",
                                      "air-quality": "checklist.airQuality",
                                      rh: "checklist.rh",
                                      "dew-point": "checklist.dewPoint",
                                      baseline: "checklist.baseline",
                                      "three-readings": "checklist.threeReadings",
                                      "reading-1": "checklist.reading1",
                                      "reading-2": "checklist.reading2",
                                      "reading-3": "checklist.reading3",
                                      "steel-pin": "checklist.steelPin",
                                      thermal: "checklist.thermal",
                                      "moisture-map-1": "checklist.moisture1",
                                      "moisture-map-2": "checklist.moisture2",
                                      "moisture-map-3": "checklist.moisture3"
                                    } as Record<string, string>
                                  )[item.id] ?? item.label
                                )}
                              </span>
                              <span className="field-notes-summary-missing-hint">
                                {item.hint}
                              </span>
                            </li>
                          ))}
                        </ol>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
          {(importError || !isEmptySlot) && (
            <div className="field-notes-notes-footer">
              {importError ? (
                <p className="field-notes-from-pictures-error" role="alert">
                  {importError}
                </p>
              ) : null}
              {!isEmptySlot ? (
                <button
                  type="button"
                  className="field-notes-annotate-btn field-notes-annotate-footer"
                  disabled={!current || busy || capturing || (tutorial && !tutorialAllows("annotate"))}
                  aria-label={t("fieldNotes.annotatePhoto")}
                  onClick={openAnnotate}
                >
                  Annotate
                </button>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {showSave && (
        <FieldNotesFinishSheet
          busy={busy}
          summary={
            shots.length === 0
              ? t("fieldNotes.saveNeedPhoto")
              : t("fieldNotes.saveSummary", { count: shots.length })
          }
          actionsDisabled={shots.length === 0}
          onClose={() => setShowSave(false)}
          onSaveInApp={() => {
            setShowSave(false);
            onSaveInApp();
          }}
          onExportDocx={() => {
            setShowSave(false);
            onExportDocx();
          }}
          onExportDmsr={() => {
            setShowSave(false);
            onExportDmsr();
          }}
        />
      )}

      {annotating && annotateUrl && current && (
        <AnnotationOverlay
          imageUrl={annotateUrl}
          imageWidth={annotateDims.width}
          imageHeight={annotateDims.height}
          initial={current.annotations ?? []}
          initialCrop={current.photoCrop}
          tutorialGhost={
            tutorialBeat === "drawCircle"
              ? "circle"
              : tutorialBeat === "drawArrow"
                ? "arrow"
                : null
          }
          onRecognizedKind={(kind) =>
            onTutorialEventRef.current?.({ type: "shape", kind })
          }
          onTutorialShapeMoved={() =>
            onTutorialEventRef.current?.({ type: "shapeMoved" })
          }
          lockFinished={Boolean(tutorial && !tutorialAllows("annotateFinish"))}
          onFinished={(annotations, crop) => {
            if (tutorial && !tutorialAllows("annotateFinish")) return;
            finishAnnotate(annotations, crop);
          }}
          coach={(() => {
            if (!tutorial || !tutorialBeat) return null;
            const spec = coachFor(tutorialBeat);
            if (!spec) return null;
            return (
              <TutorialCoach
                spec={spec}
                onNext={() => onTutorialEventRef.current?.({ type: "next" })}
              />
            );
          })()}
        />
      )}
      {tutorial && tutorialBeat && !annotating && (() => {
        const spec = coachFor(tutorialBeat);
        if (!spec || spec.placement === "home" || spec.placement === "center") {
          return null;
        }
        if (spec.placement === "viewport") return null;
        return (
          <TutorialCoach
            spec={spec}
            onNext={() => onTutorialEventRef.current?.({ type: "next" })}
          />
        );
      })()}
    </div>
  );
}
