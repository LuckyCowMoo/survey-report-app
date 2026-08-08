/**
 * Generates the PWA icons (a white water droplet on the brand blue, rounded
 * square) as PNGs without any image dependencies - pixels are computed
 * directly and encoded with Node's built-in zlib.
 *
 * Run with: node scripts/generate-icons.mjs
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const BRAND = [0x12, 0x40, 0x5e];
const WHITE = [0xff, 0xff, 0xff];

// --- minimal PNG encoder -------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  // Add filter byte 0 at the start of each scanline.
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

// --- drawing --------------------------------------------------------------
/** Signed distance-ish test for the droplet shape at unit coords (0..1). */
function insideDroplet(x, y) {
  // Circle bottom.
  const cx = 0.5;
  const cy = 0.62;
  const r = 0.24;
  const inCircle = (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  // Triangle top (apex at 0.5,0.16 widening to the circle's sides).
  const apexY = 0.16;
  if (y >= apexY && y <= cy) {
    const t = (y - apexY) / (cy - apexY);
    const halfWidth = r * t;
    if (Math.abs(x - cx) <= halfWidth) return true;
  }
  return inCircle;
}

function roundedSquareAlpha(x, y, size, radius) {
  const rx = Math.min(Math.max(x, radius), size - radius);
  const ry = Math.min(Math.max(y, radius), size - radius);
  const d = Math.hypot(x - rx, y - ry);
  return d <= radius ? 1 : 0;
}

function drawIcon(size, { transparentCorners }) {
  const rgba = Buffer.alloc(size * size * 4);
  const cornerR = Math.round(size * 0.22);
  const ss = 3; // supersampling for smooth edges
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bgHits = 0;
      let dropHits = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const px = x + (sx + 0.5) / ss;
          const py = y + (sy + 0.5) / ss;
          const inBg = transparentCorners
            ? roundedSquareAlpha(px, py, size, cornerR)
            : 1;
          if (inBg) {
            bgHits++;
            if (insideDroplet(px / size, py / size)) dropHits++;
          }
        }
      }
      const total = ss * ss;
      const alpha = Math.round((bgHits / total) * 255);
      const dropFrac = bgHits > 0 ? dropHits / bgHits : 0;
      const i = (y * size + x) * 4;
      rgba[i] = Math.round(BRAND[0] + (WHITE[0] - BRAND[0]) * dropFrac);
      rgba[i + 1] = Math.round(BRAND[1] + (WHITE[1] - BRAND[1]) * dropFrac);
      rgba[i + 2] = Math.round(BRAND[2] + (WHITE[2] - BRAND[2]) * dropFrac);
      rgba[i + 3] = alpha;
    }
  }
  return encodePng(size, size, rgba);
}

const outDir = path.join("public", "icons");
fs.mkdirSync(outDir, { recursive: true });
// Home-screen icons: iOS squares them itself, so apple-touch-icon has solid
// corners; the manifest icons keep rounded transparent corners.
fs.writeFileSync(path.join(outDir, "icon-192.png"), drawIcon(192, { transparentCorners: true }));
fs.writeFileSync(path.join(outDir, "icon-512.png"), drawIcon(512, { transparentCorners: true }));
fs.writeFileSync(
  path.join(outDir, "apple-touch-icon.png"),
  drawIcon(180, { transparentCorners: false })
);
console.log("Icons written to public/icons/");
