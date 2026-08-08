/**
 * Image helpers. Header parsing is pure JS (works in Node tests too);
 * resizing/compression uses canvas and only runs in the browser.
 */

export interface ImageDims {
  width: number;
  height: number;
}

export function mimeFromName(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "bmp":
      return "image/bmp";
    case "webp":
      return "image/webp";
    default:
      return "image/jpeg";
  }
}

/** Read intrinsic pixel dimensions from PNG or JPEG bytes. */
export function getImageDims(bytes: Uint8Array): ImageDims | null {
  // PNG: 8-byte signature, then IHDR chunk with width/height at offset 16.
  if (
    bytes.length > 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  // JPEG: scan markers for a SOF frame header.
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      // SOF0-SOF15 except DHT(C4)/DNL(C8)/DAC(CC)
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        return {
          height: view.getUint16(offset + 5),
          width: view.getUint16(offset + 7)
        };
      }
      const len = view.getUint16(offset + 2);
      offset += 2 + len;
    }
  }
  return null;
}

function bytesToBlob(bytes: Uint8Array, mime: string): Blob {
  const copy = new Uint8Array(bytes); // detach from any shared buffer
  return new Blob([copy.buffer], { type: mime });
}

async function drawScaled(
  bytes: Uint8Array,
  mime: string,
  maxDim: number
): Promise<{ canvas: HTMLCanvasElement; width: number; height: number }> {
  const blob = bytesToBlob(bytes, mime);
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return { canvas, width, height };
}

/** Downscale + JPEG-encode a photo for sending to the AI. Returns base64 (no data: prefix). */
export async function imageToAiBase64(
  bytes: Uint8Array,
  name: string,
  maxDim = 1024
): Promise<string> {
  const { canvas } = await drawScaled(bytes, mimeFromName(name), maxDim);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

export interface DocImage {
  bytes: Uint8Array;
  width: number;
  height: number;
  type: "jpg" | "png";
}

/** Compress a photo for embedding in the output document. */
export async function imageForDocument(
  bytes: Uint8Array,
  name: string,
  maxDim = 1600
): Promise<DocImage> {
  const { canvas, width, height } = await drawScaled(bytes, mimeFromName(name), maxDim);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.72);
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return { bytes: out, width, height, type: "jpg" };
}

/** Object URL for previewing an image in the UI. Caller revokes when done. */
export function imagePreviewUrl(bytes: Uint8Array, name: string): string {
  return URL.createObjectURL(bytesToBlob(bytes, mimeFromName(name)));
}
