import { TUTORIAL_ASSETS } from "./script";

const PANO_W = 2048;
const PANO_H = 1024;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

async function tryLoad(src: string): Promise<HTMLImageElement | null> {
  try {
    return await loadImage(src);
  } catch {
    return null;
  }
}

/** Vertical fog / sky so torn photogrammetry edges read as atmosphere. */
function paintAtmosphere(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#c9d6e2");
  sky.addColorStop(0.42, "#e7e4dc");
  sky.addColorStop(0.52, "#d8d2c8");
  sky.addColorStop(0.62, "#b7b1a8");
  sky.addColorStop(1, "#8f8a82");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  const fog = ctx.createRadialGradient(
    w * 0.5,
    h * 0.52,
    w * 0.08,
    w * 0.5,
    h * 0.52,
    w * 0.52
  );
  fog.addColorStop(0, "rgba(236, 232, 226, 0)");
  fog.addColorStop(0.55, "rgba(220, 216, 210, 0.28)");
  fog.addColorStop(1, "rgba(210, 208, 204, 0.92)");
  ctx.fillStyle = fog;
  ctx.fillRect(0, 0, w, h);
}

/**
 * Stick a perspective still into the centre of an equirectangular canvas and
 * feather it into fog. Used until Blender writes real `spawn.jpg` / `gutter.jpg`.
 */
function embedPhoto(
  ctx: CanvasRenderingContext2D,
  photo: HTMLImageElement,
  opts: { yawSpan: number; vCenter: number }
) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const spanPx = Math.max(64, opts.yawSpan * w);
  const aspect = photo.naturalWidth / Math.max(1, photo.naturalHeight);
  const destH = spanPx / aspect;
  const destW = spanPx;
  const x = (w - destW) / 2;
  const y = h * opts.vCenter - destH / 2;

  const layer = document.createElement("canvas");
  layer.width = w;
  layer.height = h;
  const lx = layer.getContext("2d");
  if (!lx) return;
  lx.drawImage(photo, x, y, destW, destH);
  const midX = x + destW / 2;
  const midY = y + destH / 2;
  lx.globalCompositeOperation = "destination-in";
  const mask = lx.createRadialGradient(
    midX,
    midY,
    Math.min(destW, destH) * 0.32,
    midX,
    midY,
    Math.max(destW, destH) * 0.58
  );
  mask.addColorStop(0, "rgba(0,0,0,1)");
  mask.addColorStop(0.7, "rgba(0,0,0,0.9)");
  mask.addColorStop(1, "rgba(0,0,0,0)");
  lx.fillStyle = mask;
  lx.fillRect(0, 0, w, h);
  ctx.drawImage(layer, 0, 0);
}

export type TutorialPanoKind = "spawn" | "gutter";

const cache = new Map<TutorialPanoKind, Promise<HTMLCanvasElement>>();

export function loadTutorialPano(kind: TutorialPanoKind): Promise<HTMLCanvasElement> {
  const hit = cache.get(kind);
  if (hit) return hit;
  const pending = buildPano(kind);
  cache.set(kind, pending);
  return pending;
}

async function buildPano(kind: TutorialPanoKind): Promise<HTMLCanvasElement> {
  const bakedSrc =
    kind === "spawn" ? TUTORIAL_ASSETS.spawnPano : TUTORIAL_ASSETS.gutterPano;
  const baked = await tryLoad(bakedSrc);
  const canvas = document.createElement("canvas");
  if (baked && baked.naturalWidth >= 1024) {
    canvas.width = baked.naturalWidth;
    canvas.height = baked.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not create panorama canvas.");
    ctx.drawImage(baked, 0, 0);
    return canvas;
  }

  canvas.width = PANO_W;
  canvas.height = PANO_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create panorama canvas.");
  paintAtmosphere(ctx, PANO_W, PANO_H);

  const photoSrc =
    kind === "spawn" ? TUTORIAL_ASSETS.frontPhoto : TUTORIAL_ASSETS.gutterPhoto;
  const photo = await loadImage(photoSrc);
  embedPhoto(ctx, photo, {
    yawSpan: kind === "spawn" ? 0.34 : 0.28,
    vCenter: kind === "spawn" ? 0.52 : 0.46
  });
  return canvas;
}
