/** Path + easing helpers for the home CTA gooey split. */

export const CTA_SPLIT_MS = 900;
/** Wind-up + hit stay on the old clock; height settle is 4× that squash. */
export const CTA_MERGE_MS = 2525;
export const CTA_MORPH_MS = CTA_SPLIT_MS;
export const CTA_SNAP_AT = 0.52;
export const CTA_BOUNCE_AT = 0.8;
export const CTA_PRE_SNAP_SPEED = 1.25;
/** Merge progress (0 = still split) when the wind-up peaks. */
export const CTA_MERGE_WINDUP = 236 / CTA_MERGE_MS;
/** Merge progress when the tiles first touch. */
export const CTA_MERGE_CONTACT = 519 / CTA_MERGE_MS;
/** Merge progress when the fused bar starts losing height. */
export const CTA_MERGE_SQUASH = 590 / CTA_MERGE_MS;
/** Merge progress when the silhouette is the final bar (color can still mix). */
export const CTA_MERGE_SHAPE_END = 2384 / CTA_MERGE_MS;
const CTA_MERGE_FILL_U = 165 / CTA_MERGE_MS;
const CTA_MERGE_BULGE_GROW_U = 118 / CTA_MERGE_MS;
const CTA_MERGE_WASH_U = 661 / CTA_MERGE_MS;
const CTA_MERGE_SOLID_U = 71 / CTA_MERGE_MS;

export function advanceCtaProgress(
  progress: number,
  dt: number,
  dir: number
): number {
  if (dir === 0) return progress;
  if (dir < 0) {
    return Math.max(0, progress + (dir * dt) / CTA_MERGE_MS);
  }
  let p = progress;
  let left = dt;
  if (p < CTA_SNAP_AT) {
    const fastMs = CTA_SPLIT_MS / CTA_PRE_SNAP_SPEED;
    const toSnap = (CTA_SNAP_AT - p) * fastMs;
    if (left <= toSnap) {
      return Math.min(1, p + left / fastMs);
    }
    left -= toSnap;
    p = CTA_SNAP_AT;
  }
  return Math.min(1, p + left / CTA_SPLIT_MS);
}

export function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function mixHex(a: string, b: string, t: number): string {
  const pa = Number.parseInt(a.replace("#", ""), 16);
  const pb = Number.parseInt(b.replace("#", ""), 16);
  if (!Number.isFinite(pa) || !Number.isFinite(pb)) return t < 0.5 ? a : b;
  const ar = (pa >> 16) & 255;
  const ag = (pa >> 8) & 255;
  const ab = pa & 255;
  const br = (pb >> 16) & 255;
  const bg = (pb >> 8) & 255;
  const bb = pb & 255;
  const u = clamp01(t);
  const r = Math.round(ar + (br - ar) * u);
  const g = Math.round(ag + (bg - ag) * u);
  const bl = Math.round(ab + (bb - ab) * u);
  return `#${((r << 16) | (g << 8) | bl).toString(16).padStart(6, "0")}`;
}

export function easeInCubic(t: number): number {
  return t * t * t;
}

export function easeInQuart(t: number): number {
  return t * t * t * t;
}

export function easeOutQuart(t: number): number {
  return 1 - (1 - t) ** 4;
}

export function easeOutCubic(t: number): number {
  const x = 1 - t;
  return 1 - x * x * x;
}

export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function rmax(w: number, h: number, r: number): number {
  return Math.max(0, Math.min(r, w / 2, h / 2));
}

/** Rounded rectangle in pixel space. */
export function roundedRectPath(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): string {
  const rr = rmax(w, h, r);
  const x2 = x + w;
  const y2 = y + h;
  return [
    `M ${x + rr} ${y}`,
    `H ${x2 - rr}`,
    `A ${rr} ${rr} 0 0 1 ${x2} ${y + rr}`,
    `V ${y2 - rr}`,
    `A ${rr} ${rr} 0 0 1 ${x2 - rr} ${y2}`,
    `H ${x + rr}`,
    `A ${rr} ${rr} 0 0 1 ${x} ${y2 - rr}`,
    `V ${y + rr}`,
    `A ${rr} ${rr} 0 0 1 ${x + rr} ${y}`,
    "Z"
  ].join(" ");
}

/**
 * Gooey peanut: a rounded bar with a concave waist.
 * `pinch` 0 = flat bar, ~0.92 = hairline about to snap.
 */
export function peanutPath(
  w: number,
  h: number,
  r: number,
  pinch: number
): string {
  const rr = rmax(w, h, r);
  const p = clamp01(pinch);
  const mid = w / 2;
  const inset = (h * 0.5 - 3) * p;
  const topY = inset;
  const botY = h - inset;
  const waist = Math.max(4, w * 0.08 * (1 - p * 0.93));
  const pull = lerp(w * 0.18, w * 0.08, p);
  const leftIn = mid - waist;
  const rightIn = mid + waist;
  const leftOut = Math.max(rr + 8, leftIn - pull);
  const rightOut = Math.min(w - rr - 8, rightIn + pull);

  return [
    `M ${rr} 0`,
    `H ${leftOut}`,
    `C ${leftIn} 0 ${leftIn} ${topY} ${mid} ${topY}`,
    `C ${rightIn} ${topY} ${rightIn} 0 ${rightOut} 0`,
    `H ${w - rr}`,
    `A ${rr} ${rr} 0 0 1 ${w} ${rr}`,
    `V ${h - rr}`,
    `A ${rr} ${rr} 0 0 1 ${w - rr} ${h}`,
    `H ${rightOut}`,
    `C ${rightIn} ${h} ${rightIn} ${botY} ${mid} ${botY}`,
    `C ${leftIn} ${botY} ${leftIn} ${h} ${leftOut} ${h}`,
    `H ${rr}`,
    `A ${rr} ${rr} 0 0 1 0 ${h - rr}`,
    `V ${rr}`,
    `A ${rr} ${rr} 0 0 1 ${rr} 0`,
    "Z"
  ].join(" ");
}

/** Taffy bridge that lives in the gap between two blocks. */
export function bridgePath(
  x1: number,
  x2: number,
  h: number,
  pinch: number
): string {
  const gap = x2 - x1;
  if (gap <= 0.75) return "";
  const p = clamp01(pinch);
  const mid = (x1 + x2) / 2;
  const overlap = Math.min(18, gap * 0.55);
  const left = x1 - overlap;
  const right = x2 + overlap;
  const inset = (h * 0.5 - 2.5) * p;
  const topY = inset;
  const botY = h - inset;
  const waist = Math.max(2.2, gap * 0.42 * (1 - p * 0.94));
  const pull = lerp(gap * 0.55, gap * 0.12, p);

  return [
    `M ${left} 0`,
    `C ${left + pull} 0 ${mid - waist} ${topY} ${mid} ${topY}`,
    `C ${mid + waist} ${topY} ${right - pull} 0 ${right} 0`,
    `L ${right} ${h}`,
    `C ${right - pull} ${h} ${mid + waist} ${botY} ${mid} ${botY}`,
    `C ${mid - waist} ${botY} ${left + pull} ${h} ${left} ${h}`,
    "Z"
  ].join(" ");
}

export type CtaTile = {
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
};

type Pt = { x: number; y: number };
type Cubic = { p0: Pt; c1: Pt; c2: Pt; p3: Pt };

const KAPPA = 0.5522847498307936;
const PINCH_SEGS = 16;

function lerpPt(a: Pt, b: Pt, t: number): Pt {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

function lerpPts(a: Pt[], b: Pt[], t: number): Pt[] {
  const n = Math.min(a.length, b.length);
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) out.push(lerpPt(a[i], b[i], t));
  return out;
}

function reflectPt(origin: Pt, toward: Pt): Pt {
  return { x: origin.x * 2 - toward.x, y: origin.y * 2 - toward.y };
}

function catmullRomToCubics(pts: Pt[]): Cubic[] {
  if (pts.length < 2) return [];
  const n = pts.length;
  const cubics: Cubic[] = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = i === 0 ? reflectPt(pts[0], pts[1]) : pts[i - 1];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = i + 2 >= n ? reflectPt(pts[n - 1], pts[n - 2]) : pts[i + 2];
    cubics.push({
      p0: p1,
      c1: { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
      c2: { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
      p3: p2
    });
  }
  return cubics;
}

function emitWorldCubics(pts: Pt[]): string {
  return catmullRomToCubics(pts)
    .map(
      (c) => `C ${fmtPt(c.c1)} ${fmtPt(c.c2)} ${fmtPt(c.p3)}`
    )
    .join(" ");
}

function pinchBump(t: number, p: number): number {
  const k = lerp(2.2, 3.5, clamp01(p));
  return Math.pow(Math.sin(Math.PI * clamp01(t)), k);
}

function samplePinchEdge(a: Pt, b: Pt, center: Pt, p: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= PINCH_SEGS; i++) {
    const t = i / PINCH_SEGS;
    pts.push(lerpPt(lerpPt(a, b, t), center, p * pinchBump(t, p)));
  }
  return pts;
}

function tileLocalToWorld(tile: CtaTile, lx: number, ly: number): Pt {
  const cx = tile.w / 2;
  const cy = tile.h / 2;
  const rad = (tile.rot * Math.PI) / 180;
  const dx = lx - cx;
  const dy = ly - cy;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: tile.x + cx + dx * cos - dy * sin,
    y: tile.y + cy + dx * sin + dy * cos
  };
}

function fmtPt(p: Pt): string {
  return `${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
}

function cubicWorld(
  tile: CtaTile,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): string {
  const c1 = tileLocalToWorld(tile, x0, y0);
  const c2 = tileLocalToWorld(tile, x1, y1);
  const e = tileLocalToWorld(tile, x2, y2);
  return `C ${fmtPt(c1)} ${fmtPt(c2)} ${fmtPt(e)}`;
}

function roundedTilePath(tile: CtaTile, radius: number): string {
  const rr = rmax(tile.w, tile.h, radius);
  const k = KAPPA * rr;
  const w = tile.w;
  const h = tile.h;
  return [
    `M ${fmtPt(tileLocalToWorld(tile, rr, 0))}`,
    `L ${fmtPt(tileLocalToWorld(tile, w - rr, 0))}`,
    cubicWorld(tile, w - rr + k, 0, w, rr - k, w, rr),
    `L ${fmtPt(tileLocalToWorld(tile, w, h - rr))}`,
    cubicWorld(tile, w, h - rr + k, w - rr + k, h, w - rr, h),
    `L ${fmtPt(tileLocalToWorld(tile, rr, h))}`,
    cubicWorld(tile, rr - k, h, 0, h - rr + k, 0, h - rr),
    `L ${fmtPt(tileLocalToWorld(tile, 0, rr))}`,
    cubicWorld(tile, 0, rr - k, rr - k, 0, rr, 0),
    "Z"
  ].join(" ");
}

type PinchLinks = {
  lt: Pt;
  rt: Pt;
  rb: Pt;
  lb: Pt;
  topPts: Pt[];
  botPts: Pt[];
};

function pinchLinks(
  left: CtaTile,
  right: CtaTile,
  radius: number,
  pinch: number
): PinchLinks {
  const rrL = rmax(left.w, left.h, radius);
  const rrR = rmax(right.w, right.h, radius);
  const lt = tileLocalToWorld(left, left.w - rrL, 0);
  const lb = tileLocalToWorld(left, left.w - rrL, left.h);
  const rt = tileLocalToWorld(right, rrR, 0);
  const rb = tileLocalToWorld(right, rrR, right.h);

  const p = clamp01(pinch);
  const topMid = lerpPt(lt, rt, 0.5);
  const botMid = lerpPt(lb, rb, 0.5);
  const center = lerpPt(topMid, botMid, 0.5);

  return {
    lt,
    rt,
    rb,
    lb,
    topPts: samplePinchEdge(lt, rt, center, p),
    botPts: samplePinchEdge(rb, lb, center, p)
  };
}

/**
 * Pinch/taffy whose edges are linear stretches between the inner corners
 * of the two tiles, so it stays glued as they move and rotate.
 */
export function cornerLinkedPinchPath(
  left: CtaTile,
  right: CtaTile,
  radius: number,
  pinch: number
): string {
  const s = pinchLinks(left, right, radius, pinch);
  return [
    `M ${fmtPt(s.lt)}`,
    emitWorldCubics(s.topPts),
    `L ${fmtPt(s.rb)}`,
    emitWorldCubics(s.botPts),
    "Z"
  ].join(" ");
}

function unionFromLinks(
  left: CtaTile,
  right: CtaTile,
  radius: number,
  s: PinchLinks
): string {
  const rrL = rmax(left.w, left.h, radius);
  const rrR = rmax(right.w, right.h, radius);
  const kL = KAPPA * rrL;
  const kR = KAPPA * rrR;
  const lh = left.h;
  const rw = right.w;
  const rh = right.h;

  return [
    `M ${fmtPt(tileLocalToWorld(left, rrL, 0))}`,
    `L ${fmtPt(s.lt)}`,
    emitWorldCubics(s.topPts),
    `L ${fmtPt(tileLocalToWorld(right, rw - rrR, 0))}`,
    cubicWorld(right, rw - rrR + kR, 0, rw, rrR - kR, rw, rrR),
    `L ${fmtPt(tileLocalToWorld(right, rw, rh - rrR))}`,
    cubicWorld(right, rw, rh - rrR + kR, rw - rrR + kR, rh, rw - rrR, rh),
    `L ${fmtPt(s.rb)}`,
    emitWorldCubics(s.botPts),
    `L ${fmtPt(tileLocalToWorld(left, rrL, lh))}`,
    cubicWorld(left, rrL - kL, lh, 0, lh - rrL + kL, 0, lh - rrL),
    `L ${fmtPt(tileLocalToWorld(left, 0, rrL))}`,
    cubicWorld(left, 0, rrL - kL, rrL - kL, 0, rrL, 0),
    "Z"
  ].join(" ");
}

/**
 * Single silhouette: left tile outer edges + pinch + right tile outer edges.
 * Inner corners are skipped so the pinch is interior, not a second fill.
 */
export function unionTilesPinchPath(
  left: CtaTile,
  right: CtaTile,
  radius: number,
  pinch: number
): string {
  return unionFromLinks(
    left,
    right,
    radius,
    pinchLinks(left, right, radius, pinch)
  );
}

function seamBump(
  worldX: number,
  unionX: number,
  unionW: number,
  bulgePx: number
): number {
  const u = clamp01((worldX - unionX) / Math.max(1e-6, unionW));
  const wide = Math.pow(Math.sin(Math.PI * u), 0.72);
  const x = (u - 0.5) / 0.26;
  const cap = x * x >= 1 ? 0 : Math.sqrt(1 - x * x);
  return Math.max(0, bulgePx) * (wide * 0.58 + cap * 0.42);
}

/** Same tile as usual, with the top/bottom bowed out near the seam. */
export function bulgedTilePath(
  tile: CtaTile,
  side: "left" | "right",
  radius: number,
  bulgePx: number,
  unionX: number,
  unionW: number
): string {
  const rr = rmax(tile.w, tile.h, radius);
  const k = KAPPA * rr;
  const w = tile.w;
  const h = tile.h;
  const bumpX = (lx: number) =>
    seamBump(tile.x + lx, unionX, unionW, bulgePx);
  const top: Pt[] = [];
  const bot: Pt[] = [];

  if (side === "left") {
    for (let i = 0; i <= PINCH_SEGS; i++) {
      const x = lerp(rr, w, i / PINCH_SEGS);
      top.push({ x, y: -bumpX(x) });
    }
    for (let i = 0; i <= PINCH_SEGS; i++) {
      const x = lerp(w, rr, i / PINCH_SEGS);
      bot.push({ x, y: h + bumpX(x) });
    }
    const start = top[0];
    if (!start) return "M0 0";
    return [
      `M ${fmtPt(tileLocalToWorld(tile, start.x, start.y))}`,
      emitLocalCubics(tile, top),
      `L ${fmtPt(tileLocalToWorld(tile, w, h + bumpX(w)))}`,
      emitLocalCubics(tile, bot),
      cubicWorld(tile, rr - k, h, 0, h - rr + k, 0, h - rr),
      `L ${fmtPt(tileLocalToWorld(tile, 0, rr))}`,
      cubicWorld(tile, 0, rr - k, rr - k, 0, rr, 0),
      "Z"
    ].join(" ");
  }

  for (let i = 0; i <= PINCH_SEGS; i++) {
    const x = lerp(0, w - rr, i / PINCH_SEGS);
    top.push({ x, y: -bumpX(x) });
  }
  for (let i = 0; i <= PINCH_SEGS; i++) {
    const x = lerp(w - rr, 0, i / PINCH_SEGS);
    bot.push({ x, y: h + bumpX(x) });
  }
  const start = top[0];
  if (!start) return "M0 0";
  return [
    `M ${fmtPt(tileLocalToWorld(tile, start.x, start.y))}`,
    emitLocalCubics(tile, top),
    cubicWorld(tile, w - rr + k, 0, w, rr - k, w, rr),
    `L ${fmtPt(tileLocalToWorld(tile, w, h - rr))}`,
    cubicWorld(tile, w, h - rr + k, w - rr + k, h, w - rr, h),
    emitLocalCubics(tile, bot),
    `L ${fmtPt(tileLocalToWorld(tile, 0, -bumpX(0)))}`,
    "Z"
  ].join(" ");
}

const CTA_SETTLE_AT = 0.9;

/** 1 = leftover spike, 0 = flat wall, negative = inner valley. */
function snapWallOffset(u: number): number {
  const x = clamp01(u);
  const raw =
    Math.exp(-2.2 * x) * Math.cos(x * Math.PI * 1.3) * (1 - x * x);
  return raw >= 0 ? raw : raw * 2.35;
}

function tileWorldToLocal(tile: CtaTile, pt: Pt): Pt {
  const cx = tile.w / 2;
  const cy = tile.h / 2;
  const rad = (tile.rot * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = pt.x - (tile.x + cx);
  const dy = pt.y - (tile.y + cy);
  return {
    x: cx + dx * cos + dy * sin,
    y: cy - dx * sin + dy * cos
  };
}

function mapPtToTile(
  pt: Pt,
  from: CtaTile,
  to: CtaTile,
  side: "left" | "right",
  radius: number
): Pt {
  const rrF = rmax(from.w, from.h, radius);
  const rrT = rmax(to.w, to.h, radius);
  const attachF = side === "left" ? from.w - rrF : rrF;
  const attachT = side === "left" ? to.w - rrT : rrT;
  return {
    x: attachT + (pt.x - attachF),
    y: pt.y * (to.h / Math.max(1e-6, from.h))
  };
}

function scalePtsWeighted(
  pts: Pt[],
  attachX: number,
  tipX: number,
  sBody: number,
  sTip: number
): Pt[] {
  const span = tipX - attachX;
  return pts.map((q) => {
    const w = Math.abs(span) < 1e-3 ? 0 : clamp01((q.x - attachX) / span);
    const s = lerp(sBody, sTip, w * w);
    return { x: attachX + (q.x - attachX) * s, y: q.y };
  });
}

function emitLocalCubics(tile: CtaTile, pts: Pt[]): string {
  return catmullRomToCubics(pts)
    .map((c) => {
      const c1 = tileLocalToWorld(tile, c.c1.x, c.c1.y);
      const c2 = tileLocalToWorld(tile, c.c2.x, c.c2.y);
      const e = tileLocalToWorld(tile, c.p3.x, c.p3.y);
      return `C ${fmtPt(c1)} ${fmtPt(c2)} ${fmtPt(e)}`;
    })
    .join(" ");
}

type Leftover = { pts: Pt[] };

function snapLeftovers(
  left: CtaTile,
  right: CtaTile,
  radius: number,
  pinch: number
): { left: Leftover; right: Leftover } {
  const s = pinchLinks(left, right, radius, pinch);
  const mid = PINCH_SEGS / 2;
  const leftPts = [
    ...s.topPts.slice(0, mid + 1),
    ...s.botPts.slice(mid + 1)
  ].map((pt) => tileWorldToLocal(left, pt));
  const rightPts = [
    ...s.botPts.slice(0, mid + 1),
    ...s.topPts.slice(mid + 1)
  ].map((pt) => tileWorldToLocal(right, pt));
  return { left: { pts: leftPts }, right: { pts: rightPts } };
}

function sampleWavePts(
  tile: CtaTile,
  side: "left" | "right",
  radius: number,
  amp: number
): Pt[] {
  const rr = rmax(tile.w, tile.h, radius);
  const attachX = side === "left" ? tile.w - rr : rr;
  const n = PINCH_SEGS;
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (side === "left") {
      pts.push({
        x: attachX + amp * pinchBump(t, 0.25),
        y: t * tile.h
      });
    } else {
      pts.push({
        x: attachX + amp * pinchBump(t, 0.25),
        y: (1 - t) * tile.h
      });
    }
  }
  return pts;
}

function sampleRoundedPts(
  tile: CtaTile,
  side: "left" | "right",
  radius: number,
  wallAmp: number
): Pt[] {
  const rr = rmax(tile.w, tile.h, radius);
  const w = tile.w;
  const h = tile.h;
  const n = PINCH_SEGS;
  const pts: Pt[] = [];
  const u1 = 0.26;
  const u2 = 0.74;
  const dir = side === "left" ? 1 : -1;

  if (side === "left") {
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      if (t <= u1) {
        const a = (t / u1) * (Math.PI / 2);
        const cx = w - rr;
        const cy = rr;
        pts.push({
          x: cx + rr * Math.cos(-Math.PI / 2 + a),
          y: cy + rr * Math.sin(-Math.PI / 2 + a)
        });
      } else if (t >= u2) {
        const a = ((t - u2) / (1 - u2)) * (Math.PI / 2);
        const cx = w - rr;
        const cy = h - rr;
        pts.push({
          x: cx + rr * Math.cos(a),
          y: cy + rr * Math.sin(a)
        });
      } else {
        const u = (t - u1) / (u2 - u1);
        const y = lerp(rr, h - rr, u);
        const x = w + dir * wallAmp * Math.sin(Math.PI * u);
        pts.push({ x, y });
      }
    }
    return pts;
  }

  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (t <= u1) {
      const a = (t / u1) * (Math.PI / 2);
      const cx = rr;
      const cy = h - rr;
      pts.push({
        x: cx + rr * Math.cos(Math.PI / 2 + a),
        y: cy + rr * Math.sin(Math.PI / 2 + a)
      });
    } else if (t >= u2) {
      const a = ((t - u2) / (1 - u2)) * (Math.PI / 2);
      const cx = rr;
      const cy = rr;
      pts.push({
        x: cx + rr * Math.cos(Math.PI + a),
        y: cy + rr * Math.sin(Math.PI + a)
      });
    } else {
      const u = (t - u1) / (u2 - u1);
      const y = lerp(h - rr, rr, u);
      const x = 0 + dir * wallAmp * Math.sin(Math.PI * u);
      pts.push({ x, y });
    }
  }
  return pts;
}

function innerFromLeftover(
  tile: CtaTile,
  snapTile: CtaTile,
  side: "left" | "right",
  radius: number,
  leftover: Leftover,
  sBody: number,
  sTip: number,
  heal: number,
  round: number
): Pt[] {
  const rr = rmax(tile.w, tile.h, radius);
  const attachX = side === "left" ? tile.w - rr : rr;
  const mapped = leftover.pts.map((pt) =>
    mapPtToTile(pt, snapTile, tile, side, radius)
  );
  const tipX =
    side === "left"
      ? mapped.reduce((m, p) => Math.max(m, p.x), attachX)
      : mapped.reduce((m, p) => Math.min(m, p.x), attachX);
  const scaled = scalePtsWeighted(mapped, attachX, tipX, sBody, sTip);
  const hAmt = clamp01(heal);
  const amp = (tipX - attachX) * sBody * (1 - 0.42 * hAmt);
  const wave = sampleWavePts(tile, side, radius, amp);
  const shaped = hAmt <= 0 ? scaled : lerpPts(scaled, wave, hAmt);
  const r = clamp01(round);
  if (r <= 0) return shaped;
  const valley = Math.min(0, sBody) * Math.min(tile.h * 0.18, tile.w * 0.22);
  const rounded = sampleRoundedPts(tile, side, radius, valley);
  return lerpPts(shaped, rounded, r);
}

function islandFromInner(
  tile: CtaTile,
  side: "left" | "right",
  radius: number,
  inner: Pt[]
): string {
  const rr = rmax(tile.w, tile.h, radius);
  const k = KAPPA * rr;
  const w = tile.w;
  const h = tile.h;
  const start = inner[0];
  if (!start) return "M0 0";
  if (side === "left") {
    return [
      `M ${fmtPt(tileLocalToWorld(tile, rr, 0))}`,
      `L ${fmtPt(tileLocalToWorld(tile, start.x, start.y))}`,
      emitLocalCubics(tile, inner),
      `L ${fmtPt(tileLocalToWorld(tile, rr, h))}`,
      cubicWorld(tile, rr - k, h, 0, h - rr + k, 0, h - rr),
      `L ${fmtPt(tileLocalToWorld(tile, 0, rr))}`,
      cubicWorld(tile, 0, rr - k, rr - k, 0, rr, 0),
      "Z"
    ].join(" ");
  }
  return [
    `M ${fmtPt(tileLocalToWorld(tile, rr, 0))}`,
    `L ${fmtPt(tileLocalToWorld(tile, w - rr, 0))}`,
    cubicWorld(tile, w - rr + k, 0, w, rr - k, w, rr),
    `L ${fmtPt(tileLocalToWorld(tile, w, h - rr))}`,
    cubicWorld(tile, w, h - rr + k, w - rr + k, h, w - rr, h),
    `L ${fmtPt(tileLocalToWorld(tile, start.x, start.y))}`,
    emitLocalCubics(tile, inner),
    "Z"
  ].join(" ");
}

function splitIslandPaths(
  left: CtaTile,
  right: CtaTile,
  snapLeft: CtaTile,
  snapRight: CtaTile,
  leftover: { left: Leftover; right: Leftover },
  radius: number,
  sBody: number,
  sTip: number,
  heal: number,
  round: number
): { leftD: string; rightD: string } {
  return {
    leftD: islandFromInner(
      left,
      "left",
      radius,
      innerFromLeftover(
        left,
        snapLeft,
        "left",
        radius,
        leftover.left,
        sBody,
        sTip,
        heal,
        round
      )
    ),
    rightD: islandFromInner(
      right,
      "right",
      radius,
      innerFromLeftover(
        right,
        snapRight,
        "right",
        radius,
        leftover.right,
        sBody,
        sTip,
        heal,
        round
      )
    )
  };
}

export type CtaMorphFrame = {
  peanutD: string;
  peanutX: number;
  peanutOpacity: number;
  tileOpacity: number;
  leftIslandD: string;
  rightIslandD: string;
  solidFade: number;
  pinch: number;
  colorT: number;
  left: CtaTile;
  right: CtaTile;
  pop: number;
  labelMerged: number;
  labelSplit: number;
  joinU0: number;
  joinU1: number;
  joinX0: number;
  joinX1: number;
  /** 0 = hard split at the seam, 0.5 = wash across the full bar. */
  washSpread: number;
};

function pullSpread(t: number, overshoot: number): number {
  if (t <= CTA_SNAP_AT) {
    return overshoot * easeOutQuart(t / CTA_SNAP_AT);
  }
  if (t < CTA_BOUNCE_AT) {
    const u = (t - CTA_SNAP_AT) / (CTA_BOUNCE_AT - CTA_SNAP_AT);
    return overshoot * (1 - easeInOutCubic(u));
  }
  const b = (t - CTA_BOUNCE_AT) / (1 - CTA_BOUNCE_AT);
  return -overshoot * 0.11 * Math.sin(Math.PI * b) * (1 - b);
}

function pullTilt(t: number, maxTilt: number): number {
  if (t <= CTA_SNAP_AT) {
    return maxTilt * easeInCubic(t / CTA_SNAP_AT);
  }
  if (t < CTA_BOUNCE_AT) {
    const u = (t - CTA_SNAP_AT) / (CTA_BOUNCE_AT - CTA_SNAP_AT);
    return maxTilt * (1 - easeOutCubic(u));
  }
  return 0;
}

function layoutTiles(
  t: number,
  boxW: number,
  boxH: number,
  gap: number
): { left: CtaTile; right: CtaTile; pinch: number } {
  const overshoot = boxW * 0.2;
  const grow = easeOutCubic(clamp01(t / 0.86));
  const restW = Math.max(8, (boxW - gap) / 2);
  const tileW = lerp(boxW / 2, restW, grow);
  const extraGap = boxW - tileW * 2;
  const spread = pullSpread(t, overshoot);
  const rot = pullTilt(t, 18);
  const leftX = -spread;
  const rightX = tileW + extraGap + spread;
  return {
    left: { x: leftX, y: 0, w: tileW, h: boxH, rot: -rot },
    right: { x: rightX, y: 0, w: tileW, h: boxH, rot },
    pinch: easeInCubic(clamp01(t / CTA_SNAP_AT))
  };
}

/**
 * Grow and pinch while the tiles wind up and pull apart.
 * They hit max spread as the waist snaps, then immediately travel back in.
 */
export function ctaMorphFrame(
  tRaw: number,
  boxW: number,
  boxH: number,
  radius: number,
  gap: number
): CtaMorphFrame {
  const t = clamp01(tRaw);
  const { left, right, pinch } = layoutTiles(t, boxW, boxH, gap);
  const connected = t < CTA_SNAP_AT;
  const afterSnap = connected ? 0 : clamp01((t - CTA_SNAP_AT) / 0.18);
  const settleU = connected
    ? 0
    : clamp01((t - CTA_SNAP_AT) / (CTA_SETTLE_AT - CTA_SNAP_AT));
  const wallP = connected ? 1 : snapWallOffset(settleU);
  const heal = connected ? 0 : easeOutCubic(clamp01(settleU / 0.15));
  const sTip = wallP * (1 - 0.7 * heal);
  const wallR = connected
    ? 0
    : easeOutCubic(clamp01((0.06 - wallP) / 0.06));

  const snap = layoutTiles(CTA_SNAP_AT, boxW, boxH, gap);
  const leftover = snapLeftovers(snap.left, snap.right, radius, snap.pinch);
  const islands = splitIslandPaths(
    left,
    right,
    snap.left,
    snap.right,
    leftover,
    radius,
    wallP,
    sTip,
    heal,
    wallR
  );

  const leftEdge = tileLocalToWorld(left, 0, boxH / 2);
  const joinX0 = leftEdge.x;
  const joinX1 = tileLocalToWorld(right, right.w, boxH / 2).x;
  const joinU0 = clamp01(joinX0 / boxW);
  const joinU1 = clamp01(joinX1 / boxW);
  const settled =
    !connected && wallR >= 0.995 && Math.abs(wallP) < 0.012;
  const leftIslandD = settled
    ? roundedTilePath(left, radius)
    : connected
      ? ""
      : islands.leftD;
  const rightIslandD = settled
    ? roundedTilePath(right, radius)
    : connected
      ? ""
      : islands.rightD;
  const peanutD = connected
    ? unionTilesPinchPath(left, right, radius, pinch)
    : `${leftIslandD} ${rightIslandD}`;

  const colorT = 1;
  const solidFade = connected
    ? 0
    : clamp01((t - CTA_SNAP_AT - 0.08) / 0.42);
  const labelMerged = 1 - clamp01(t / 0.18);
  const labelSplit = t < CTA_SNAP_AT
    ? 0
    : clamp01((t - CTA_SNAP_AT) / 0.16);

  let pop = 0;
  if (!connected) {
    pop =
      afterSnap < 0.22
        ? afterSnap / 0.22
        : Math.max(0, 1 - (afterSnap - 0.22) / 0.7);
  }

  return {
    peanutD,
    peanutX: 0,
    peanutOpacity: 1,
    tileOpacity: 0,
    leftIslandD,
    rightIslandD,
    solidFade,
    pinch,
    colorT,
    left,
    right,
    pop: clamp01(pop),
    labelMerged,
    labelSplit,
    joinU0,
    joinU1,
    joinX0,
    joinX1,
    washSpread: 0.5
  };
}

/**
 * Close is not a reverse of the split: a short wind-up, then the tiles
 * slam together, a wide shallow bulge + slow wash, then the bar settles
 * while the colors keep mixing.
 */
function layoutMergeTiles(
  u: number,
  boxW: number,
  boxH: number,
  gap: number
): { left: CtaTile; right: CtaTile; touching: boolean } {
  const restW = Math.max(8, (boxW - gap) / 2);
  const backup = Math.min(22, Math.max(14, gap * 1.35));
  let tileW = restW;
  let leftX = 0;
  let rightX = restW + gap;

  if (u < CTA_MERGE_WINDUP) {
    const travel = backup * easeOutCubic(u / CTA_MERGE_WINDUP);
    leftX = -travel;
    rightX = restW + gap + travel;
  } else if (u < CTA_MERGE_CONTACT) {
    const slam = easeInQuart(
      (u - CTA_MERGE_WINDUP) / (CTA_MERGE_CONTACT - CTA_MERGE_WINDUP)
    );
    const travel = lerp(backup, -gap / 2, slam);
    leftX = -travel;
    rightX = restW + gap + travel;
  } else {
    const fill = easeOutCubic(
      clamp01((u - CTA_MERGE_CONTACT) / CTA_MERGE_FILL_U)
    );
    tileW = lerp(restW, boxW / 2, fill);
    leftX = lerp(gap / 2, 0, fill);
    rightX = leftX + tileW;
  }

  const left: CtaTile = { x: leftX, y: 0, w: tileW, h: boxH, rot: 0 };
  const right: CtaTile = { x: rightX, y: 0, w: tileW, h: boxH, rot: 0 };
  return {
    left,
    right,
    touching: right.x - (left.x + left.w) <= 0.65
  };
}

export function ctaMergeFrame(
  tRaw: number,
  boxW: number,
  boxH: number,
  radius: number,
  gap: number
): CtaMorphFrame {
  const t = clamp01(tRaw);
  const u = 1 - t;
  const { left, right, touching } = layoutMergeTiles(u, boxW, boxH, gap);

  let bulgePx = 0;
  if (u >= CTA_MERGE_CONTACT && u < CTA_MERGE_SHAPE_END) {
    const grow = easeOutCubic(
      clamp01((u - CTA_MERGE_CONTACT) / CTA_MERGE_BULGE_GROW_U)
    );
    const recede = easeInOutCubic(
      clamp01(
        (u - CTA_MERGE_SQUASH) /
          Math.max(0.001, CTA_MERGE_SHAPE_END - CTA_MERGE_SQUASH)
      )
    );
    bulgePx = Math.min(8, boxH * 0.038) * 1.25 * grow * (1 - recede);
  }

  const unionX = left.x;
  const unionW = Math.max(1, right.x + right.w - left.x);
  const leftIslandD = touching
    ? bulgedTilePath(left, "left", radius, bulgePx, unionX, unionW)
    : roundedTilePath(left, radius);
  const rightIslandD = touching
    ? bulgedTilePath(right, "right", radius, bulgePx, unionX, unionW)
    : roundedTilePath(right, radius);
  const peanutD = `${leftIslandD} ${rightIslandD}`;

  let washSpread = 0.004;
  if (touching) {
    const washT = clamp01((u - CTA_MERGE_CONTACT) / CTA_MERGE_WASH_U);
    washSpread = 0.5 * easeOutQuart(washT);
  }

  const solidFade = touching
    ? 1 - easeOutCubic(clamp01((u - CTA_MERGE_CONTACT) / CTA_MERGE_SOLID_U))
    : 1;

  const leftEdge = tileLocalToWorld(left, 0, boxH / 2);
  const joinX0 = leftEdge.x;
  const joinX1 = tileLocalToWorld(right, right.w, boxH / 2).x;

  return {
    peanutD,
    peanutX: 0,
    peanutOpacity: 1,
    tileOpacity: 0,
    leftIslandD,
    rightIslandD,
    solidFade,
    pinch: 0,
    colorT: 1,
    left,
    right,
    pop: 0,
    labelMerged: clamp01((u - 0.74) / 0.16),
    labelSplit:
      u < CTA_MERGE_WINDUP
        ? 1
        : 1 - clamp01((u - CTA_MERGE_WINDUP) / 0.16),
    joinU0: clamp01(joinX0 / boxW),
    joinU1: clamp01(joinX1 / boxW),
    joinX0,
    joinX1,
    washSpread
  };
}

export type CtaParticle = {
  id: number;
  ox: number;
  oy: number;
  dx: number;
  dy: number;
  r: number;
  side: "left" | "right";
};

export const CTA_PARTICLES: CtaParticle[] = [
  { id: 0, ox: -6, oy: -8, dx: -28, dy: -36, r: 5.5, side: "left" },
  { id: 1, ox: 4, oy: 6, dx: 22, dy: -30, r: 4.2, side: "right" },
  { id: 2, ox: -2, oy: 10, dx: -18, dy: 34, r: 3.6, side: "left" },
  { id: 3, ox: 8, oy: -4, dx: 32, dy: 22, r: 6, side: "right" },
  { id: 4, ox: -10, oy: 2, dx: -36, dy: 8, r: 3.2, side: "left" },
  { id: 5, ox: 2, oy: -12, dx: 14, dy: -40, r: 2.8, side: "right" },
  { id: 6, ox: -4, oy: 14, dx: -10, dy: 38, r: 4.8, side: "left" },
  { id: 7, ox: 10, oy: 8, dx: 30, dy: 16, r: 3, side: "right" }
];
