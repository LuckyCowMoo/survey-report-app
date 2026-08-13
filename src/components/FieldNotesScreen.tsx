import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from "react";
import {
  captureJpegFromVideo,
  listVideoCameras,
  loadPreferredCameraId,
  savePreferredCameraId,
  startCamera,
  stopCamera,
  type CameraDeviceInfo
} from "../lib/cameraCapture";
import {
  countMatchedShorthandNotes,
  createFieldNoteShot,
  formatFieldNoteCreated,
  renumberFieldNotes
} from "../lib/fieldNotes";
import type { FieldNoteShot } from "../types";
import FieldNotesFinishSheet from "./FieldNotesFinishSheet";

type Props = {
  shots: FieldNoteShot[];
  onChange: (next: FieldNoteShot[]) => void;
  busy: boolean;
  onSaveAndLeave: () => void;
  onContinueToReport: () => void;
  onExportDocx: () => void;
};

type Mode = "live" | "review" | "retake";

const SWIPE_MIN_PX = 56;

export default function FieldNotesScreen({
  shots,
  onChange,
  busy,
  onSaveAndLeave,
  onContinueToReport,
  onExportDocx
}: Props) {
  /** Index 0..shots.length — `shots.length` is the empty “new note” slot. */
  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState<Mode>("live");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [showFinish, setShowFinish] = useState(false);
  const [cameras, setCameras] = useState<CameraDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState<string | null>(() =>
    loadPreferredCameraId()
  );
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraIdRef = useRef(cameraId);
  cameraIdRef.current = cameraId;
  const swipeRef = useRef<{
    id: number;
    x: number;
    y: number;
    skip: boolean;
  } | null>(null);
  const thumbUrlRef = useRef<string | null>(null);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);

  const maxIndex = shots.length; // inclusive empty slot
  const safeIndex = Math.max(0, Math.min(index, maxIndex));
  const current = safeIndex < shots.length ? shots[safeIndex] : null;
  const isEmptySlot = current === null;
  const showLive = isEmptySlot || mode === "live" || mode === "retake";

  const matchedCount = useMemo(
    () => countMatchedShorthandNotes(shots),
    [shots]
  );

  const stopStream = useCallback(() => {
    stopCamera(streamRef.current);
    streamRef.current = null;
    const v = videoRef.current;
    if (v) v.srcObject = null;
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

  const ensureCamera = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    setCameraError(null);
    try {
      stopCamera(streamRef.current);
      streamRef.current = null;
      streamRef.current = await startCamera(video, cameraIdRef.current);
      const list = await refreshCameras();
      const trackId = streamRef.current
        .getVideoTracks()[0]
        ?.getSettings().deviceId;
      if (trackId) {
        const known = list.some((c) => c.deviceId === trackId);
        if (known && trackId !== cameraIdRef.current) {
          setCameraId(trackId);
          savePreferredCameraId(trackId);
        }
      }
    } catch (err) {
      setCameraError(err instanceof Error ? err.message : String(err));
    }
  }, [refreshCameras]);

  useEffect(() => {
    if (showLive) void ensureCamera();
    else stopStream();
  }, [showLive, cameraId, ensureCamera, stopStream]);

  useEffect(() => () => stopStream(), [stopStream]);

  useEffect(() => {
    if (thumbUrlRef.current) {
      URL.revokeObjectURL(thumbUrlRef.current);
      thumbUrlRef.current = null;
    }
    if (!current || showLive) {
      setThumbUrl(null);
      return;
    }
    const copy = new Uint8Array(current.image.byteLength);
    copy.set(current.image);
    const url = URL.createObjectURL(new Blob([copy], { type: "image/jpeg" }));
    thumbUrlRef.current = url;
    setThumbUrl(url);
    return () => {
      if (thumbUrlRef.current) {
        URL.revokeObjectURL(thumbUrlRef.current);
        thumbUrlRef.current = null;
      }
    };
  }, [current, showLive, current?.id, current?.image]);

  useEffect(() => {
    if (index > shots.length) setIndex(shots.length);
  }, [shots.length, index]);

  const goTo = (i: number) => {
    const next = Math.max(0, Math.min(shots.length, i));
    setIndex(next);
    if (next >= shots.length) setMode("live");
    else setMode("review");
  };

  const cycleCamera = async () => {
    if (busy || capturing) return;
    let list = cameras;
    if (list.length < 2) list = await refreshCameras();
    if (list.length < 2) {
      // Still one device (labels often hidden until permission) — retry open.
      await ensureCamera();
      return;
    }
    const cur = cameraIdRef.current;
    const at = Math.max(
      0,
      list.findIndex((c) => c.deviceId === cur)
    );
    const next = list[(at + 1) % list.length];
    if (!next) return;
    setCameraId(next.deviceId);
    savePreferredCameraId(next.deviceId);
  };

  const updateCurrent = (patch: Partial<FieldNoteShot>) => {
    if (!current) return;
    onChange(
      shots.map((s, i) => (i === safeIndex ? { ...s, ...patch } : s))
    );
  };

  const takePhoto = async () => {
    if (capturing || busy) return;
    const video = videoRef.current;
    if (!video || !streamRef.current) {
      await ensureCamera();
      return;
    }
    setCapturing(true);
    try {
      const bytes = await captureJpegFromVideo(video);
      if (mode === "retake" && current) {
        onChange(
          shots.map((s, i) =>
            i === safeIndex
              ? {
                  ...s,
                  image: bytes,
                  imageName: `image${s.number}.jpeg`,
                  created: s.created || formatFieldNoteCreated()
                }
              : s
          )
        );
        setMode("review");
      } else {
        const shot = createFieldNoteShot(bytes, {
          imageName: `image${shots.length + 1}.jpeg`
        });
        const next = renumberFieldNotes([...shots, shot]);
        onChange(next);
        setIndex(next.length - 1);
        setMode("review");
      }
    } catch (err) {
      setCameraError(err instanceof Error ? err.message : String(err));
    } finally {
      setCapturing(false);
    }
  };

  const deleteCurrent = () => {
    if (!current) return;
    const next = renumberFieldNotes(shots.filter((_, i) => i !== safeIndex));
    onChange(next);
    if (next.length === 0) {
      setIndex(0);
      setMode("live");
    } else {
      setIndex(Math.min(safeIndex, next.length - 1));
      setMode("review");
    }
  };

  const onSwipeDown = (e: ReactPointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const t = e.target;
    if (
      t instanceof Element &&
      t.closest("textarea,input,button,a,label,select,[contenteditable='true']")
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
  };

  const onSwipeMove = (e: ReactPointerEvent) => {
    const s = swipeRef.current;
    if (!s || s.id !== e.pointerId || s.skip) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 24) {
      s.skip = true;
    }
  };

  const onSwipeUp = (e: ReactPointerEvent) => {
    const s = swipeRef.current;
    if (!s || s.id !== e.pointerId) return;
    swipeRef.current = null;
    if (s.skip) return;
    const dx = e.clientX - s.x;
    if (Math.abs(dx) < SWIPE_MIN_PX) return;
    // Finger left → next (including empty new-note slot to the right)
    if (dx < 0) goTo(safeIndex + 1);
    else goTo(safeIndex - 1);
  };

  const activeCameraLabel =
    cameras.find((c) => c.deviceId === cameraId)?.label ?? "Camera";

  return (
    <div
      className="field-notes"
      onPointerDown={onSwipeDown}
      onPointerMove={onSwipeMove}
      onPointerUp={onSwipeUp}
      onPointerCancel={onSwipeUp}
    >
      <div className="field-notes-stage">
        <div className="field-notes-camera-panel">
          {showLive ? (
            <>
              <video
                ref={videoRef}
                className="field-notes-video"
                playsInline
                muted
                autoPlay
              />
              {cameraError && (
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
            </>
          ) : (
            thumbUrl && (
              <img
                className="field-notes-photo"
                src={thumbUrl}
                alt={`Field note (${current?.number ?? ""})`}
                draggable={false}
              />
            )
          )}

          <div className="field-notes-cam-float field-notes-cam-float-top">
            <span className="field-notes-index-chip">
              {isEmptySlot
                ? shots.length === 0
                  ? "New note"
                  : `New · after ${shots.length}`
                : `${safeIndex + 1}/${shots.length}`}
            </span>
            <div className="field-notes-cam-float-top-actions">
              {cameras.length > 1 ? (
                <label className="field-notes-camera-pick">
                  <select
                    value={cameraId ?? cameras[0]?.deviceId ?? ""}
                    disabled={busy || capturing}
                    aria-label="Choose camera"
                    onChange={(e) => {
                      const id = e.target.value;
                      setCameraId(id);
                      savePreferredCameraId(id);
                    }}
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
                  className="field-notes-float-btn"
                  disabled={busy || capturing}
                  title={activeCameraLabel}
                  aria-label={`Refresh cameras (current: ${activeCameraLabel})`}
                  onClick={() => void cycleCamera()}
                >
                  Camera
                </button>
              )}
            </div>
          </div>

          <div className="field-notes-cam-float field-notes-cam-float-bottom">
            <div className="field-notes-cam-float-side">
              <button
                type="button"
                className="field-notes-float-btn"
                disabled={!current || busy || isEmptySlot}
                onClick={() => setMode("retake")}
              >
                Retake
              </button>
              <button
                type="button"
                className="field-notes-arrow"
                aria-label="Previous photo"
                disabled={safeIndex <= 0 || busy}
                onClick={() => goTo(safeIndex - 1)}
              >
                ◀
              </button>
            </div>
            <div className="field-notes-cam-float-side">
              <button
                type="button"
                className="field-notes-arrow"
                aria-label="Next photo"
                disabled={safeIndex >= shots.length || busy}
                onClick={() => goTo(safeIndex + 1)}
              >
                ▶
              </button>
              <button
                type="button"
                className="field-notes-float-btn field-notes-float-danger"
                disabled={!current || busy || isEmptySlot}
                onClick={deleteCurrent}
              >
                Delete
              </button>
            </div>
          </div>
        </div>

        <button
          type="button"
          className="field-notes-shutter"
          aria-label={mode === "retake" ? "Retake photo" : "Take photo"}
          disabled={
            busy ||
            capturing ||
            Boolean(cameraError && showLive) ||
            (!isEmptySlot && mode !== "retake" && mode !== "live")
          }
          onClick={() => void takePhoto()}
        >
          <span>{mode === "retake" ? "Retake" : "Take photo"}</span>
        </button>

        <div className="field-notes-notes-panel">
          <div className="field-notes-notes-header">
            <div className="field-notes-notes-heading">
              <span className="field-notes-notes-label">
                {isEmptySlot ? "New note" : "Notes"}
              </span>
              <p className="field-notes-stats" aria-live="polite">
                {shots.length} photo{shots.length === 1 ? "" : "s"}
                {" · "}
                {matchedCount} matched shorthand
              </p>
            </div>
            {isEmptySlot ? (
              <button
                type="button"
                className="btn primary field-notes-finish-inline"
                disabled={busy}
                onClick={() => setShowFinish(true)}
              >
                Finish
              </button>
            ) : (
              current && (
                <label className="field-notes-created">
                  <span>Created</span>
                  <input
                    type="text"
                    value={current.created}
                    disabled={busy}
                    onChange={(e) =>
                      updateCurrent({ created: e.target.value })
                    }
                    aria-label="Created date"
                  />
                </label>
              )
            )}
          </div>
          <textarea
            id="field-notes-text"
            className="field-notes-textarea"
            placeholder={
              isEmptySlot
                ? "Take a photo to start this note…"
                : "Add a note for this photo…"
            }
            value={current?.note ?? ""}
            disabled={!current || busy}
            onChange={(e) => updateCurrent({ note: e.target.value })}
          />
        </div>
      </div>

      {showFinish && (
        <FieldNotesFinishSheet
          shotCount={shots.length}
          busy={busy}
          onClose={() => setShowFinish(false)}
          onSaveAndLeave={() => {
            setShowFinish(false);
            onSaveAndLeave();
          }}
          onContinueToReport={() => {
            setShowFinish(false);
            onContinueToReport();
          }}
          onExportDocx={() => {
            onExportDocx();
          }}
        />
      )}
    </div>
  );
}
