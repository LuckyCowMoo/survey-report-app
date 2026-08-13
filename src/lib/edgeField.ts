import type { NormPoint } from "../types";

/** Downsampled Sobel edge field for stroke-vs-photo alignment checks. */
export type EdgeField = {
  width: number;
  height: number;
  /** Gradient magnitude per pixel. */
  mag: Float32Array;
  /** Unit vector along the edge (⊥ gradient), per pixel. */
  dirX: Float32Array;
  dirY: Float32Array;
  /** Magnitudes below this are treated as non-edges. */
  magFloor: number;
};

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("edge field: image load failed"));
    img.src = url;
  });
}

/**
 * Build a compact Sobel edge field from a photo URL (blob/data/same-origin).
 * Returns null if the image can't be sampled (e.g. tainted canvas).
 */
export async function buildEdgeField(
  imageUrl: string,
  maxDim = 288
): Promise<EdgeField | null> {
  try {
    const img = await loadImage(imageUrl);
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    if (iw < 8 || ih < 8) return null;

    const scale = Math.min(1, maxDim / Math.max(iw, ih));
    const w = Math.max(8, Math.round(iw * scale));
    const h = Math.max(8, Math.round(ih * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);

    let pixels: ImageData;
    try {
      pixels = ctx.getImageData(0, 0, w, h);
    } catch {
      return null;
    }

    const gray = new Float32Array(w * h);
    const data = pixels.data;
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      gray[p] =
        0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
    }

    const mag = new Float32Array(w * h);
    const dirX = new Float32Array(w * h);
    const dirY = new Float32Array(w * h);
    let magMax = 0;

    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const gx =
          -gray[i - w - 1]! +
          gray[i - w + 1]! -
          2 * gray[i - 1]! +
          2 * gray[i + 1]! -
          gray[i + w - 1]! +
          gray[i + w + 1]!;
        const gy =
          -gray[i - w - 1]! -
          2 * gray[i - w]! -
          gray[i - w + 1]! +
          gray[i + w - 1]! +
          2 * gray[i + w]! +
          gray[i + w + 1]!;
        const m = Math.hypot(gx, gy);
        mag[i] = m;
        if (m > magMax) magMax = m;
        // Edge runs perpendicular to the gradient.
        const el = Math.hypot(-gy, gx) || 1;
        dirX[i] = -gy / el;
        dirY[i] = gx / el;
      }
    }

    if (magMax < 1e-3) return null;
    const magFloor = magMax * 0.12;

    return { width: w, height: h, mag, dirX, dirY, magFloor };
  } catch {
    return null;
  }
}

function sampleNear(
  field: EdgeField,
  nx: number,
  ny: number,
  radiusPx: number
): { mag: number; dirX: number; dirY: number; x: number; y: number } | null {
  const w = field.width;
  const h = field.height;
  const cx = Math.round(nx * (w - 1));
  const cy = Math.round(ny * (h - 1));
  let bestMag = 0;
  let bestDx = 0;
  let bestDy = 0;
  let bestX = cx;
  let bestY = cy;
  const r = Math.max(1, radiusPx | 0);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue;
      const i = y * w + x;
      const m = field.mag[i]!;
      if (m > bestMag) {
        bestMag = m;
        bestDx = field.dirX[i]!;
        bestDy = field.dirY[i]!;
        bestX = x;
        bestY = y;
      }
    }
  }
  if (bestMag < field.magFloor) return null;
  return { mag: bestMag, dirX: bestDx, dirY: bestDy, x: bestX, y: bestY };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function fieldRadius(field: EdgeField): number {
  return Math.max(2, Math.round(0.028 * Math.min(field.width, field.height)));
}

/** Project a normalized point onto the strongest nearby photo edge. */
export function snapPointToEdge(
  p: NormPoint,
  field: EdgeField,
  radiusPx = fieldRadius(field)
): NormPoint | null {
  const edge = sampleNear(field, p.x, p.y, radiusPx);
  if (!edge) return null;
  const w = field.width;
  const h = field.height;
  // Edge pixel center in normalized coords.
  const ex = edge.x / Math.max(1, w - 1);
  const ey = edge.y / Math.max(1, h - 1);
  // Project p onto the infinite edge line through (ex,ey).
  const dx = p.x - ex;
  const dy = p.y - ey;
  const t = dx * edge.dirX + dy * edge.dirY;
  return {
    x: clamp01(ex + edge.dirX * t),
    y: clamp01(ey + edge.dirY * t)
  };
}

function dist(a: NormPoint, b: NormPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function turnScore(a: NormPoint, b: NormPoint, c: NormPoint): number {
  const v1x = b.x - a.x;
  const v1y = b.y - a.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const l1 = Math.hypot(v1x, v1y);
  const l2 = Math.hypot(v2x, v2y);
  if (l1 < 1e-6 || l2 < 1e-6) return 0;
  const dot = (v1x * v2x + v1y * v2y) / (l1 * l2);
  return 1 - Math.max(-1, Math.min(1, dot));
}

function pathLength(pts: NormPoint[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1]!, pts[i]!);
  return len;
}

/** Index at least `target` path-length away from `from` (backward). */
function lookBack(pts: NormPoint[], from: number, target: number): number {
  let left = 0;
  for (let i = from; i > 0 && left < target; i--) {
    left += dist(pts[i]!, pts[i - 1]!);
    if (left >= target) return i - 1;
  }
  return 0;
}

/** Index at least `target` path-length away from `from` (forward). */
function lookAhead(pts: NormPoint[], from: number, target: number): number {
  let left = 0;
  for (let i = from; i < pts.length - 1 && left < target; i++) {
    left += dist(pts[i]!, pts[i + 1]!);
    if (left >= target) return i + 1;
  }
  return pts.length - 1;
}

/**
 * Keep endpoints + local-maxima of sharp turns from the stroke, so vertices
 * sit where the user actually changed direction.
 */
export function extractSharpCorners(
  pts: NormPoint[],
  minTurn = 0.22,
  minSeg = 0.012
): NormPoint[] {
  if (pts.length < 2) return pts.map((p) => ({ ...p }));
  if (pts.length < 4) return [{ ...pts[0]! }, { ...pts[pts.length - 1]! }];

  const total = pathLength(pts);
  const span = Math.max(0.012, Math.min(0.045, total * 0.08));
  const turns = new Float32Array(pts.length);

  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[lookBack(pts, i, span)]!;
    const b = pts[i]!;
    const c = pts[lookAhead(pts, i, span)]!;
    turns[i] = turnScore(a, b, c);
  }

  const out: NormPoint[] = [{ ...pts[0]! }];
  let lastKept = 0;
  const peakWin = Math.max(1, Math.floor(pts.length * 0.02));

  for (let i = 1; i < pts.length - 1; i++) {
    const t = turns[i]!;
    if (t < minTurn) continue;
    let isPeak = true;
    for (let k = 1; k <= peakWin; k++) {
      if (i - k >= 0 && turns[i - k]! > t) isPeak = false;
      if (i + k < pts.length && turns[i + k]! > t) isPeak = false;
      if (!isPeak) break;
    }
    if (!isPeak) continue;
    if (dist(pts[lastKept]!, pts[i]!) < minSeg) {
      // Prefer the sharper of two close candidates.
      if (lastKept > 0 && t > turns[lastKept]!) {
        out[out.length - 1] = { ...pts[i]! };
        lastKept = i;
      }
      continue;
    }
    out.push({ ...pts[i]! });
    lastKept = i;
  }

  const end = pts[pts.length - 1]!;
  if (dist(out[out.length - 1]!, end) < minSeg * 0.4 && out.length > 1) {
    out[out.length - 1] = { ...end };
  } else {
    out.push({ ...end });
  }
  return out;
}

function dedupeClose(pts: NormPoint[], minDist: number): NormPoint[] {
  if (pts.length === 0) return [];
  const out: NormPoint[] = [{ ...pts[0]! }];
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i]!;
    if (dist(out[out.length - 1]!, p) >= minDist) out.push({ ...p });
    else out[out.length - 1] = { ...p };
  }
  return out;
}

/**
 * Pull a point onto a nearby edge, but never farther than `maxMove` from the
 * user's stroke vertex (keeps sharp turns where they were drawn).
 */
function snapPointRespectful(
  p: NormPoint,
  field: EdgeField,
  maxMove: number
): NormPoint {
  const snapped = snapPointToEdge(p, field);
  if (!snapped) return { ...p };
  const d = dist(p, snapped);
  if (d <= 1e-9) return snapped;
  if (d <= maxMove) return snapped;
  const t = maxMove / d;
  return {
    x: clamp01(p.x + (snapped.x - p.x) * t),
    y: clamp01(p.y + (snapped.y - p.y) * t)
  };
}

/**
 * Build an abstract sharp-corner polyline snapped to photo edges.
 * Corner locations follow the user's turns; only a short nudge onto edges.
 */
export function buildEdgeSnappedPolyline(
  pts: NormPoint[],
  field: EdgeField
): NormPoint[] | null {
  if (pts.length < 3) return null;
  const corners = extractSharpCorners(pts);
  if (corners.length < 2) return null;

  // Endpoints may travel farther onto the edge; interior corners stay put.
  const snapped = corners.map((c, i) => {
    const isEnd = i === 0 || i === corners.length - 1;
    return snapPointRespectful(c, field, isEnd ? 0.035 : 0.014);
  });

  const cleaned = dedupeClose(snapped, 0.005);
  if (cleaned.length < 2) return null;

  let len = 0;
  for (let i = 1; i < cleaned.length; i++) {
    len += dist(cleaned[i - 1]!, cleaned[i]!);
  }
  if (len < 0.03) return null;
  return cleaned;
}

/**
 * Fraction of the stroke (0–1) that runs close and roughly parallel to a
 * strong photo edge. High scores mean the scribble is tracing structure.
 */
export function edgeTrackScore(pts: NormPoint[], field: EdgeField): number {
  if (pts.length < 3) return 0;

  const samples = Math.min(36, Math.max(10, pts.length));
  let hits = 0;
  let considered = 0;
  const radiusPx = fieldRadius(field);

  for (let s = 0; s < samples; s++) {
    const t = s / (samples - 1);
    const idx = Math.min(pts.length - 1, Math.round(t * (pts.length - 1)));
    const p = pts[idx]!;
    const i0 = Math.max(0, idx - 1);
    const i1 = Math.min(pts.length - 1, idx + 1);
    const a = pts[i0]!;
    const b = pts[i1]!;
    const tx = b.x - a.x;
    const ty = b.y - a.y;
    const tl = Math.hypot(tx, ty);
    if (tl < 1e-6) continue;

    const edge = sampleNear(field, p.x, p.y, radiusPx);
    if (!edge) continue;
    considered += 1;

    const ux = tx / tl;
    const uy = ty / tl;
    const parallel = Math.abs(ux * edge.dirX + uy * edge.dirY);
    if (parallel >= 0.82) hits += 1;
  }

  if (considered < 4) return 0;
  const nearFrac = considered / samples;
  const parallelFrac = hits / considered;
  return parallelFrac * Math.min(1, nearFrac / 0.55);
}
