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

async function canvasToImage(canvas: HTMLCanvasElement): Promise<HTMLImageElement> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Could not encode panorama."))),
      "image/jpeg",
      0.9
    );
  });
  const url = URL.createObjectURL(blob);
  return loadImage(url);
}

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
  layer.width = Math.max(1, Math.ceil(destW));
  layer.height = Math.max(1, Math.ceil(destH));
  const lx = layer.getContext("2d");
  if (!lx) return;
  lx.drawImage(photo, 0, 0, layer.width, layer.height);
  lx.globalCompositeOperation = "destination-in";
  const mask = lx.createRadialGradient(
    layer.width / 2,
    layer.height / 2,
    Math.min(layer.width, layer.height) * 0.32,
    layer.width / 2,
    layer.height / 2,
    Math.max(layer.width, layer.height) * 0.58
  );
  mask.addColorStop(0, "rgba(0,0,0,1)");
  mask.addColorStop(0.7, "rgba(0,0,0,0.9)");
  mask.addColorStop(1, "rgba(0,0,0,0)");
  lx.fillStyle = mask;
  lx.fillRect(0, 0, layer.width, layer.height);
  ctx.drawImage(layer, x, y, destW, destH);
}

export type TutorialPanoKind = "spawn" | "gutter";

const cache = new Map<TutorialPanoKind, Promise<HTMLImageElement>>();

export function loadTutorialPano(kind: TutorialPanoKind): Promise<HTMLImageElement> {
  const hit = cache.get(kind);
  if (hit) return hit;
  const pending = buildPano(kind);
  cache.set(kind, pending);
  return pending;
}

/**
 * 90° clockwise roll on the sphere, same as the viewfinder (`(x,y) → (y,-x)`).
 */
function rollEquirectForViewfinder(src: HTMLImageElement): Promise<HTMLImageElement> {
  const w = src.naturalWidth || PANO_W;
  const h = src.naturalHeight || PANO_H;
  const read = document.createElement("canvas");
  read.width = w;
  read.height = h;
  const rx = read.getContext("2d", { willReadFrequently: true });
  if (!rx) throw new Error("Could not read panorama.");
  rx.drawImage(src, 0, 0);
  const srcPx = rx.getImageData(0, 0, w, h).data;
  const out = rx.createImageData(w, h);
  const dst = out.data;
  const twoPi = Math.PI * 2;
  for (let y = 0; y < h; y++) {
    const lat = (0.5 - (y + 0.5) / h) * Math.PI;
    const cl = Math.cos(lat);
    const sl = Math.sin(lat);
    for (let x = 0; x < w; x++) {
      const lon = ((x + 0.5) / w - 0.5) * twoPi;
      const dx = Math.sin(lon) * cl;
      const dy = sl;
      const dz = -Math.cos(lon) * cl;
      const rxd = dy;
      const ryd = -dx;
      const rzd = dz;
      const lon2 = Math.atan2(rxd, -rzd);
      const lat2 = Math.asin(Math.max(-1, Math.min(1, ryd)));
      let u = (lon2 / twoPi + 0.5) * w;
      let v = (0.5 - lat2 / Math.PI) * h;
      u = ((u % w) + w) % w;
      v = Math.max(0, Math.min(h - 1.0001, v));
      const x0 = Math.floor(u);
      const y0 = Math.floor(v);
      const x1 = (x0 + 1) % w;
      const y1 = Math.min(h - 1, y0 + 1);
      const fx = u - x0;
      const fy = v - y0;
      const i00 = (y0 * w + x0) * 4;
      const i10 = (y0 * w + x1) * 4;
      const i01 = (y1 * w + x0) * 4;
      const i11 = (y1 * w + x1) * 4;
      const o = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) {
        const a = srcPx[i00 + c] * (1 - fx) + srcPx[i10 + c] * fx;
        const b = srcPx[i01 + c] * (1 - fx) + srcPx[i11 + c] * fx;
        dst[o + c] = a * (1 - fy) + b * fy;
      }
    }
  }
  rx.putImageData(out, 0, 0);
  return canvasToImage(read);
}

async function buildPano(kind: TutorialPanoKind): Promise<HTMLImageElement> {
  const bakedSrc =
    kind === "spawn" ? TUTORIAL_ASSETS.spawnPano : TUTORIAL_ASSETS.gutterPano;
  const baked = await tryLoad(bakedSrc);
  if (baked && baked.naturalWidth >= 1024) {
    return rollEquirectForViewfinder(baked);
  }

  const canvas = document.createElement("canvas");
  canvas.width = PANO_W;
  canvas.height = PANO_H;
  const ctx = canvas.getContext("2d", { willReadFrequently: false });
  if (!ctx) throw new Error("Could not create panorama canvas.");
  paintAtmosphere(ctx, PANO_W, PANO_H);

  const photoSrc =
    kind === "spawn" ? TUTORIAL_ASSETS.frontPhoto : TUTORIAL_ASSETS.gutterPhoto;
  const photo = await loadImage(photoSrc);
  embedPhoto(ctx, photo, {
    yawSpan: kind === "spawn" ? 0.34 : 0.28,
    vCenter: kind === "spawn" ? 0.52 : 0.46
  });
  const standIn = await canvasToImage(canvas);
  return rollEquirectForViewfinder(standIn);
}
