import type { NormPoint, PhotoAnnotation } from "../types";
import { type EdgeField, edgeTrackScore, buildEdgeSnappedPolyline } from "./edgeField";
import { calloutAttachPoint, calloutMetrics } from "./callout";

export type StrokePoint = NormPoint;

function dist(a: NormPoint, b: NormPoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function pathLength(pts: NormPoint[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1]!, pts[i]!);
  return len;
}

function resample(pts: NormPoint[], n: number): NormPoint[] {
  if (pts.length === 0) return [];
  if (pts.length === 1 || n <= 1) return [{ ...pts[0]! }];
  const total = pathLength(pts);
  if (total < 1e-6) return Array.from({ length: n }, () => ({ ...pts[0]! }));
  const step = total / (n - 1);
  const out: NormPoint[] = [{ ...pts[0]! }];
  let budget = step;
  let i = 1;
  let prev = pts[0]!;
  while (out.length < n && i < pts.length) {
    const cur = pts[i]!;
    const seg = dist(prev, cur);
    if (seg < 1e-9) {
      i += 1;
      continue;
    }
    if (budget <= seg) {
      const t = budget / seg;
      const p = {
        x: prev.x + (cur.x - prev.x) * t,
        y: prev.y + (cur.y - prev.y) * t
      };
      out.push(p);
      prev = p;
      budget = step;
    } else {
      budget -= seg;
      prev = cur;
      i += 1;
    }
  }
  while (out.length < n) out.push({ ...pts[pts.length - 1]! });
  return out;
}

/** Max perpendicular distance from chord a→b, as fraction of chord length. */
function lineDeviation(pts: NormPoint[]): number {
  if (pts.length < 2) return 0;
  const a = pts[0]!;
  const b = pts[pts.length - 1]!;
  const len = dist(a, b);
  if (len < 1e-6) return 1;
  let max = 0;
  for (const p of pts) {
    const cross = (p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x);
    max = Math.max(max, Math.abs(cross) / len);
  }
  return max / len;
}

/** Algebraic circle fit (Kåsa). Radius relative to image width (x units). */
function fitCircle(
  pts: NormPoint[]
): { center: NormPoint; radius: number; rms: number } | null {
  if (pts.length < 5) return null;
  let sumX = 0;
  let sumY = 0;
  let sumX2 = 0;
  let sumY2 = 0;
  let sumXY = 0;
  let sumX3 = 0;
  let sumY3 = 0;
  let sumX2Y = 0;
  let sumXY2 = 0;
  const n = pts.length;
  for (const p of pts) {
    const x = p.x;
    const y = p.y;
    const x2 = x * x;
    const y2 = y * y;
    sumX += x;
    sumY += y;
    sumX2 += x2;
    sumY2 += y2;
    sumXY += x * y;
    sumX3 += x2 * x;
    sumY3 += y2 * y;
    sumX2Y += x2 * y;
    sumXY2 += x * y2;
  }
  const C = n * sumX2 - sumX * sumX;
  const D = n * sumXY - sumX * sumY;
  const E = n * sumY2 - sumY * sumY;
  const G = 0.5 * (n * (sumX3 + sumXY2) - sumX * (sumX2 + sumY2));
  const H = 0.5 * (n * (sumY3 + sumX2Y) - sumY * (sumX2 + sumY2));
  const denom = C * E - D * D;
  if (Math.abs(denom) < 1e-12) return null;
  const cx = (G * E - H * D) / denom;
  const cy = (H * C - G * D) / denom;
  let rSum = 0;
  for (const p of pts) rSum += Math.hypot(p.x - cx, p.y - cy);
  const radius = rSum / n;
  if (!(radius > 0.01) || radius > 0.75) return null;
  let err = 0;
  for (const p of pts) {
    const d = Math.hypot(p.x - cx, p.y - cy) - radius;
    err += d * d;
  }
  return {
    center: { x: cx, y: cy },
    radius,
    rms: Math.sqrt(err / n)
  };
}

function angularCoverage(pts: NormPoint[], center: NormPoint): number {
  const angles = pts.map((p) => Math.atan2(p.y - center.y, p.x - center.x));
  angles.sort((a, b) => a - b);
  let maxGap = 0;
  for (let i = 1; i < angles.length; i++) {
    maxGap = Math.max(maxGap, angles[i]! - angles[i - 1]!);
  }
  maxGap = Math.max(
    maxGap,
    Math.PI * 2 - (angles[angles.length - 1]! - angles[0]!)
  );
  return Math.PI * 2 - maxGap;
}

/** Turn sharpness at index i: 0 = straight, ~2 = reverse. */
function turnAt(pts: NormPoint[], i: number, span = 3): number {
  const n = pts.length;
  if (i <= 0 || i >= n - 1) return 0;
  const a = pts[Math.max(0, i - span)]!;
  const b = pts[i]!;
  const c = pts[Math.min(n - 1, i + span)]!;
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

/**
 * Arrow: straight-ish stalk, then a two-stroke chevron head (both wings).
 * One continuous stroke: tail → tip → wing → (back) → other wing.
 */
function tryArrow(pts: NormPoint[]): { tail: NormPoint; tip: NormPoint } | null {
  if (pts.length < 8) return null;
  const total = pathLength(pts);
  if (total < 0.04) return null;

  const n = pts.length;
  const tail = pts[0]!;
  let best: { tip: NormPoint; score: number } | null = null;

  const tipLo = Math.floor(n * 0.22);
  const tipHi = Math.floor(n * 0.78);

  for (let tipIdx = tipLo; tipIdx <= tipHi; tipIdx++) {
    const tip = pts[tipIdx]!;
    const shaft = pts.slice(0, tipIdx + 1);
    const head = pts.slice(tipIdx);
    const shaftLen = pathLength(shaft);
    const headLen = pathLength(head);
    if (shaftLen < 0.028 || headLen < 0.028) continue;
    if (shaftLen < total * 0.18 || headLen < total * 0.14) continue;
    if (lineDeviation(shaft) > 0.36) continue;

    // First head stroke: must turn off the shaft at the tip.
    const tipTurn = turnAt(pts, tipIdx);
    if (tipTurn < 0.14) continue;

    // Second head stroke: another real corner somewhere after the tip.
    let secondTurn = 0;
    let secondAt = -1;
    for (let i = tipIdx + 3; i < n - 1; i++) {
      const t = turnAt(pts, i);
      if (t > secondTurn) {
        secondTurn = t;
        secondAt = i;
      }
    }
    if (secondAt < 0 || secondTurn < 0.14) continue;

    const shaftDx = tip.x - tail.x;
    const shaftDy = tip.y - tail.y;
    const shaftDist = Math.hypot(shaftDx, shaftDy);
    if (shaftDist < 0.035) continue;
    const ux = shaftDx / shaftDist;
    const uy = shaftDy / shaftDist;
    const px = -uy;
    const py = ux;

    // Two wing tips: farthest head points on opposite sides of the shaft.
    let left: NormPoint | null = null;
    let right: NormPoint | null = null;
    let leftR = 0;
    let rightR = 0;
    for (let i = tipIdx + 1; i < n; i++) {
      const p = pts[i]!;
      const dx = p.x - tip.x;
      const dy = p.y - tip.y;
      const radial = Math.hypot(dx, dy);
      if (radial < 0.012) continue;
      const along = dx * ux + dy * uy;
      // Wings sit beside / behind the tip, not far past it.
      if (along > radial * 0.6) continue;
      const side = dx * px + dy * py;
      if (side > 0.003 && radial > leftR) {
        leftR = radial;
        left = p;
      } else if (side < -0.003 && radial > rightR) {
        rightR = radial;
        right = p;
      }
    }
    if (!left || !right) continue;
    if (leftR < 0.014 || rightR < 0.014) continue;
    if (Math.max(leftR, rightR) / Math.min(leftR, rightR) > 3.8) continue;

    const a1x = left.x - tip.x;
    const a1y = left.y - tip.y;
    const a2x = right.x - tip.x;
    const a2y = right.y - tip.y;
    const l1 = Math.hypot(a1x, a1y);
    const l2 = Math.hypot(a2x, a2y);
    const cos = (a1x * a2x + a1y * a2y) / (l1 * l2);
    const chevron = Math.acos(Math.max(-1, Math.min(1, cos)));
    // Open V — reject near-flat or folded-shut heads.
    if (chevron < (28 * Math.PI) / 180 || chevron > (150 * Math.PI) / 180) {
      continue;
    }

    // Chevron opens back toward the tail (shaft points into the V).
    const bisX = a1x / l1 + a2x / l2;
    const bisY = a1y / l1 + a2y / l2;
    const bisL = Math.hypot(bisX, bisY);
    if (bisL < 1e-6) continue;
    const align = (bisX / bisL) * -ux + (bisY / bisL) * -uy;
    if (align < 0.12) continue;

    const score =
      tipTurn +
      secondTurn +
      align +
      Math.min(leftR, rightR) * 8 +
      Math.min(shaftLen, headLen) * 2;
    if (!best || score > best.score) best = { tip, score };
  }

  if (!best) return null;
  return { tail, tip: best.tip };
}

/** True when the stroke looks like a drawn circle / fat arc. */
function tryCircle(pts: NormPoint[]): { center: NormPoint; radius: number } | null {
  const circle = fitCircle(pts);
  if (!circle) return null;

  const { center, radius, rms } = circle;
  const relErr = rms / radius;
  // Eagerer now that arrows require a two-wing head.
  if (relErr > 0.3) return null;

  const total = pathLength(pts);
  const circumference = Math.PI * 2 * radius;
  const travel = total / Math.max(circumference, 1e-6);
  if (travel < 0.32 || travel > 1.65) return null;

  const coverage = angularCoverage(pts, center);
  const closure = dist(pts[0]!, pts[pts.length - 1]!);
  const closedWell = closure < radius * 1.05;
  const closedLoosely = closure < radius * 1.45;

  if (closedWell && coverage > Math.PI * 0.7) return { center, radius };
  if (closedLoosely && coverage > Math.PI * 0.9) return { center, radius };
  if (coverage > Math.PI * 1.05) return { center, radius };
  return null;
}

/** Ramer–Douglas–Peucker simplify. epsilon in normalized units. */
export function rdpSimplify(pts: NormPoint[], epsilon: number): NormPoint[] {
  if (pts.length < 3) return pts.map((p) => ({ ...p }));
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  let maxDist = 0;
  let idx = 0;
  const len = dist(first, last) || 1e-9;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i]!;
    const cross =
      Math.abs((p.x - first.x) * (last.y - first.y) - (p.y - first.y) * (last.x - first.x)) /
      len;
    if (cross > maxDist) {
      maxDist = cross;
      idx = i;
    }
  }
  if (maxDist > epsilon) {
    const left = rdpSimplify(pts.slice(0, idx + 1), epsilon);
    const right = rdpSimplify(pts.slice(idx), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [
    { ...first },
    { ...last }
  ];
}

/** One Chaikin subdivision pass for freehand polish. */
function chaikin(pts: NormPoint[], iterations = 2): NormPoint[] {
  let cur = pts;
  for (let k = 0; k < iterations; k++) {
    if (cur.length < 2) break;
    const next: NormPoint[] = [{ ...cur[0]! }];
    for (let i = 0; i < cur.length - 1; i++) {
      const a = cur[i]!;
      const b = cur[i + 1]!;
      next.push({
        x: 0.75 * a.x + 0.25 * b.x,
        y: 0.75 * a.y + 0.25 * b.y
      });
      next.push({
        x: 0.25 * a.x + 0.75 * b.x,
        y: 0.25 * a.y + 0.75 * b.y
      });
    }
    next.push({ ...cur[cur.length - 1]! });
    cur = next;
  }
  return cur;
}

export function smoothFreehand(pts: NormPoint[]): NormPoint[] {
  // 25% less smoothing than the original (epsilon 0.008 / 2 Chaikin passes).
  const simplified = rdpSimplify(pts, 0.006);
  const smoothed = chaikin(simplified, 1);
  return smoothed.length >= 2 ? smoothed : pts.map((p) => ({ ...p }));
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `ann-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Classify a finished stroke into a clean shape, or smoothed freehand.
 * Points must already be in normalized image coordinates.
 * Order: arrow / circle / line first; edge-following strokes that don't
 * match those become an abstract snapped polyline; else freehand.
 */
export function recognizeStroke(
  raw: NormPoint[],
  edges?: EdgeField | null,
  options?: { detectShapes?: boolean }
): PhotoAnnotation | null {
  if (raw.length < 2) return null;
  const total = pathLength(raw);
  if (total < 0.015) return null;

  const pts = resample(raw, Math.min(72, Math.max(20, raw.length)));
  const id = newId();

  if (options?.detectShapes === false) {
    return {
      id,
      kind: "freehand",
      points: smoothFreehand(raw)
    };
  }

  const track = edges ? edgeTrackScore(pts, edges) : 0;

  // Recognised shapes first — before edge-abstract polylines.
  const arrow = tryArrow(pts);
  if (arrow) {
    return { id, kind: "arrow", tail: arrow.tail, tip: arrow.tip };
  }

  const circle = tryCircle(pts);
  if (circle) {
    return {
      id,
      kind: "circle",
      center: circle.center,
      // Snap slightly smaller than the fitted scribble so the clean ring
      // sits inside the drawn stroke.
      radius: circle.radius * 0.75
    };
  }

  const lineDev = lineDeviation(pts);
  const chord = dist(pts[0]!, pts[pts.length - 1]!);
  if (lineDev < 0.05 && chord > 0.035) {
    return {
      id,
      kind: "line",
      a: { ...pts[0]! },
      b: { ...pts[pts.length - 1]! }
    };
  }

  if (lineDev < 0.1 && chord > 0.045) {
    return {
      id,
      kind: "line",
      a: { ...pts[0]! },
      b: { ...pts[pts.length - 1]! }
    };
  }

  // No clean shape — if tracing photo edges, build a sharp snapped polyline.
  if (edges && track >= 0.42) {
    const poly = buildEdgeSnappedPolyline(pts, edges);
    if (poly && poly.length >= 2) {
      return { id, kind: "polyline", points: poly };
    }
  }

  return {
    id,
    kind: "freehand",
    points: smoothFreehand(raw)
  };
}

/** Distance from point to annotation (normalized space), for erase hit-testing. */
export function annotationHitDistance(
  ann: PhotoAnnotation,
  p: NormPoint,
  aspect = 1
): number {
  const sy = aspect; // y scaled if image not square — callers pass height/width
  const px = p.x;
  const py = p.y * sy;

  const dPoint = (a: NormPoint) =>
    Math.hypot(a.x - px, a.y * sy - py);

  if (ann.kind === "line" || ann.kind === "arrow") {
    const a = ann.kind === "line" ? ann.a : ann.tail;
    const b = ann.kind === "line" ? ann.b : ann.tip;
    const ax = a.x;
    const ay = a.y * sy;
    const bx = b.x;
    const by = b.y * sy;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1e-9;
    let t = ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }
  if (ann.kind === "circle") {
    const r = ann.radius; // in x units
    const d = Math.hypot(ann.center.x - px, ann.center.y * sy - py);
    return Math.abs(d - r);
  }
  if (ann.kind === "callout") {
    const m = calloutMetrics(ann.text, 360, aspect);
    const attach = calloutAttachPoint(ann.anchor, ann.label, m.tw, m.thY);
    const ax = ann.anchor.x;
    const ay = ann.anchor.y * sy;
    const bx = attach.x;
    const by = attach.y * sy;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1e-9;
    let t = ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const dLine = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    const dAnchor = dPoint(ann.anchor);
    const lx = ann.label.x;
    const ly = ann.label.y * sy;
    const rw = m.tw;
    const rh = m.thY * sy;
    const cx = Math.max(lx, Math.min(lx + rw, px));
    const cy = Math.max(ly, Math.min(ly + rh, py));
    const dBox = Math.hypot(px - cx, py - cy);
    return Math.min(dLine, dAnchor, dBox);
  }
  // freehand / polyline
  if (ann.kind !== "freehand" && ann.kind !== "polyline") return Infinity;
  let min = Infinity;
  for (let i = 1; i < ann.points.length; i++) {
    const a = ann.points[i - 1]!;
    const b = ann.points[i]!;
    const ax = a.x;
    const ay = a.y * sy;
    const bx = b.x;
    const by = b.y * sy;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1e-9;
    let t = ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    min = Math.min(min, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
  }
  for (const q of ann.points) min = Math.min(min, dPoint(q));
  return min;
}

export function hitTestAnnotation(
  annotations: PhotoAnnotation[],
  p: NormPoint,
  threshold = 0.028,
  aspect = 1
): PhotoAnnotation | null {
  let best: PhotoAnnotation | null = null;
  let bestD = threshold;
  for (let i = annotations.length - 1; i >= 0; i--) {
    const ann = annotations[i]!;
    const d = annotationHitDistance(ann, p, aspect);
    if (d < bestD) {
      bestD = d;
      best = ann;
    }
  }
  return best;
}
