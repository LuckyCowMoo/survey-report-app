import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { renderAsync } from "docx-preview";

type Props = {
  blob: Blob;
};

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;

/** One-page-tall scroller of the finished .docx, fitted to page width. */
export default function DocxPreview({ blob }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const nativeRef = useRef({ w: 0, h: 0 });
  const [fitScale, setFitScale] = useState(1);
  const [pageSize, setPageSize] = useState({ w: 0, h: 0 });
  const [userZoom, setUserZoom] = useState(1);
  const userZoomRef = useRef(1);
  const pinchRef = useRef<{ dist: number; zoom: number } | null>(null);
  userZoomRef.current = userZoom;

  useEffect(() => {
    const host = hostRef.current;
    const frame = frameRef.current;
    if (!host || !frame) return;
    let cancelled = false;
    host.replaceChildren();
    nativeRef.current = { w: 0, h: 0 };
    setUserZoom(1);
    setFitScale(1);
    setPageSize({ w: 0, h: 0 });
    const body = document.createElement("div");
    body.className = "docx-preview-body";
    host.append(body);

    const measureFit = () => {
      if (cancelled) return;
      const page = body.querySelector<HTMLElement>(".docx");
      if (!page) return;
      const wrap = body.querySelector<HTMLElement>(".docx-wrapper");
      const pageW = page.offsetWidth;
      if (pageW < 8) return;
      const pageH = wrap?.scrollHeight || page.offsetHeight || 1;
      nativeRef.current = { w: pageW, h: pageH };
      const avail = Math.max(1, frame.clientWidth - 8);
      setPageSize((prev) =>
        prev.w === pageW && prev.h === pageH ? prev : { w: pageW, h: pageH }
      );
      setFitScale((prev) => {
        const next = avail / pageW;
        return Math.abs(prev - next) < 0.0005 ? prev : next;
      });
    };

    void renderAsync(blob, body, undefined, {
      className: "docx-preview-doc",
      inWrapper: true,
      breakPages: true,
      ignoreLastRenderedPageBreak: true,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
      renderEndnotes: true
    })
      .then(() => {
        if (cancelled) return;
        measureFit();
        requestAnimationFrame(() => {
          measureFit();
          requestAnimationFrame(measureFit);
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        body.textContent =
          err instanceof Error ? err.message : "Could not preview this document.";
      });

    const ro = new ResizeObserver(() => measureFit());
    ro.observe(frame);
    return () => {
      cancelled = true;
      ro.disconnect();
      host.replaceChildren();
    };
  }, [blob]);

  const ready = pageSize.w > 0;
  const scale = ready ? fitScale * userZoom : 1;
  const clampZoom = (next: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));

  const onWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const next = e.deltaY < 0 ? userZoom * 1.08 : userZoom / 1.08;
    setUserZoom(clampZoom(next));
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "touch") return;
  };

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const distOf = (e: TouchEvent) => {
      if (e.touches.length < 2) return 0;
      const a = e.touches.item(0)!;
      const b = e.touches.item(1)!;
      return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    };
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        pinchRef.current = { dist: distOf(e), zoom: userZoomRef.current };
      }
    };
    const onMove = (e: TouchEvent) => {
      const pinch = pinchRef.current;
      if (!pinch || e.touches.length < 2) return;
      e.preventDefault();
      const d = distOf(e);
      if (pinch.dist < 8) return;
      setUserZoom(clampZoom(pinch.zoom * (d / pinch.dist)));
    };
    const onEnd = () => {
      pinchRef.current = null;
    };
    frame.addEventListener("touchstart", onStart, { passive: true });
    frame.addEventListener("touchmove", onMove, { passive: false });
    frame.addEventListener("touchend", onEnd);
    frame.addEventListener("touchcancel", onEnd);
    return () => {
      frame.removeEventListener("touchstart", onStart);
      frame.removeEventListener("touchmove", onMove);
      frame.removeEventListener("touchend", onEnd);
      frame.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  return (
    <div className="docx-preview">
      <div
        ref={frameRef}
        className="docx-preview-frame"
        aria-label="Document preview"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
      >
        <div
          className="docx-preview-zoom"
          style={
            ready
              ? {
                  width: pageSize.w * scale,
                  height: pageSize.h * scale,
                  overflow: "hidden"
                }
              : undefined
          }
        >
          <div
            ref={hostRef}
            className="docx-preview-host"
            style={
              ready
                ? {
                    width: pageSize.w,
                    transform: `scale(${scale})`,
                    transformOrigin: "top left"
                  }
                : undefined
            }
          />
        </div>
      </div>
      <div className="docx-preview-zoom-bar">
        <button
          type="button"
          className="btn tiny"
          disabled={userZoom <= MIN_ZOOM}
          onClick={() => setUserZoom((z) => clampZoom(z / 1.2))}
        >
          −
        </button>
        <input
          type="range"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={0.05}
          value={userZoom}
          aria-label="Preview zoom"
          onChange={(e) => setUserZoom(Number(e.target.value))}
        />
        <button
          type="button"
          className="btn tiny"
          disabled={userZoom >= MAX_ZOOM}
          onClick={() => setUserZoom((z) => clampZoom(z * 1.2))}
        >
          +
        </button>
      </div>
    </div>
  );
}
