import type { NormPoint, PhotoAnnotation } from "../types";
import { calloutAttachPoint, calloutMetrics } from "./callout";

const INK = "#e11d2e";
const LINE_WIDTH_FRAC = 0.0045; // relative to image width
const FONT_COMPOSITE = 16;

function bytesToBlob(bytes: Uint8Array, mime: string): Blob {
  const copy = new Uint8Array(bytes);
  return new Blob([copy.buffer], { type: mime });
}

function loadImage(bytes: Uint8Array): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(bytesToBlob(bytes, "image/jpeg"));
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not decode photo for annotation composite."));
    };
    img.src = url;
  });
}

function toPx(p: NormPoint, w: number, h: number): { x: number; y: number } {
  return { x: p.x * w, y: p.y * h };
}

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  tip: { x: number; y: number },
  tail: { x: number; y: number },
  headLen: number
) {
  const ang = Math.atan2(tip.y - tail.y, tip.x - tail.x);
  const spread = Math.PI / 7;
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(
    tip.x - headLen * Math.cos(ang - spread),
    tip.y - headLen * Math.sin(ang - spread)
  );
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(
    tip.x - headLen * Math.cos(ang + spread),
    tip.y - headLen * Math.sin(ang + spread)
  );
  ctx.stroke();
}

export function paintAnnotations(
  ctx: CanvasRenderingContext2D,
  annotations: PhotoAnnotation[],
  width: number,
  height: number
) {
  const lw = Math.max(2, width * LINE_WIDTH_FRAC);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = lw;

  for (const ann of annotations) {
    if (ann.kind === "freehand" || ann.kind === "polyline") {
      if (ann.points.length < 2) continue;
      ctx.beginPath();
      const p0 = toPx(ann.points[0]!, width, height);
      ctx.moveTo(p0.x, p0.y);
      for (let i = 1; i < ann.points.length; i++) {
        const p = toPx(ann.points[i]!, width, height);
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
      continue;
    }
    if (ann.kind === "line") {
      const a = toPx(ann.a, width, height);
      const b = toPx(ann.b, width, height);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      continue;
    }
    if (ann.kind === "circle") {
      const c = toPx(ann.center, width, height);
      const r = ann.radius * width;
      ctx.beginPath();
      ctx.arc(c.x, c.y, Math.max(1, r), 0, Math.PI * 2);
      ctx.stroke();
      continue;
    }
    if (ann.kind === "arrow") {
      const tail = toPx(ann.tail, width, height);
      const tip = toPx(ann.tip, width, height);
      const shaftLen = Math.hypot(tip.x - tail.x, tip.y - tail.y);
      const headLen = Math.max(lw * 4, Math.min(shaftLen * 0.28, width * 0.06));
      ctx.beginPath();
      ctx.moveTo(tail.x, tail.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();
      drawArrowHead(ctx, tip, tail, headLen);
      continue;
    }
    if (ann.kind === "callout") {
      const m = calloutMetrics(ann.text, width, height / Math.max(width, 1));
      const attach = calloutAttachPoint(ann.anchor, ann.label, m.tw, m.thY);
      const anchor = toPx(ann.anchor, width, height);
      const join = toPx(attach, width, height);
      const label = toPx(ann.label, width, height);
      const boxW = m.tw * width;
      const boxH = m.thW * width;
      const fontPx = FONT_COMPOSITE;

      ctx.beginPath();
      ctx.moveTo(anchor.x, anchor.y);
      ctx.lineTo(join.x, join.y);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(anchor.x, anchor.y, Math.max(2, lw * 1.1), 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
      ctx.fillRect(label.x, label.y, boxW, boxH);
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(1.5, lw * 0.85);
      ctx.beginPath();
      ctx.moveTo(label.x, label.y + boxH);
      ctx.lineTo(label.x + boxW, label.y + boxH);
      ctx.stroke();

      ctx.fillStyle = INK;
      ctx.font = `650 ${fontPx}px system-ui, sans-serif`;
      ctx.textBaseline = "middle";
      ctx.fillText(m.display, label.x + 4, label.y + boxH / 2);
      ctx.strokeStyle = INK;
      ctx.fillStyle = INK;
      ctx.lineWidth = lw;
    }
  }
}

/** Draw annotations onto a JPEG copy of the photo (for Word / matcher images). */
export async function compositeAnnotationsOntoJpeg(
  image: Uint8Array,
  annotations: PhotoAnnotation[] | undefined
): Promise<Uint8Array> {
  if (!annotations || annotations.length === 0) return image;
  const img = await loadImage(image);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return image;
  ctx.drawImage(img, 0, 0);
  paintAnnotations(ctx, annotations, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", 0.92)
  );
  if (!blob) return image;
  return new Uint8Array(await blob.arrayBuffer());
}
