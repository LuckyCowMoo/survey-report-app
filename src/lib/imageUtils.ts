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
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (out) => (out ? resolve(out) : reject(new Error("JPEG encode failed"))),
      "image/jpeg",
      0.72
    );
  });
  const out = new Uint8Array(await blob.arrayBuffer());
  return { bytes: out, width, height, type: "jpg" };
}

async function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Could not read that picture."));
    el.src = src;
  });
}

async function bitmapFromImage(img: HTMLImageElement): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(img, { imageOrientation: "from-image" });
  } catch {
    return await createImageBitmap(img);
  }
}

async function bitmapFromFile(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    /* continue */
  }
  try {
    return await createImageBitmap(file);
  } catch {
    /* continue */
  }

  const url = URL.createObjectURL(file);
  try {
    return await bitmapFromImage(await loadHtmlImage(url));
  } catch {
    /* continue */
  } finally {
    URL.revokeObjectURL(url);
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Could not read that picture."));
    reader.readAsDataURL(file);
  });
  return bitmapFromImage(await loadHtmlImage(dataUrl));
}

/** Decode a gallery/camera-roll file and JPEG-encode it for a field note. */
export async function jpegBytesFromImageFile(
  file: File,
  maxDim = 1920,
  quality = 0.88
): Promise<Uint8Array> {
  const bitmap = await bitmapFromFile(file);
  try {
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not read that picture.");
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      const fail = () => reject(new Error("Could not encode picture."));
      const finish = (out: Blob | null) => (out ? resolve(out) : fail());
      try {
        canvas.toBlob(finish, "image/jpeg", quality);
      } catch {
        fail();
      }
    }).catch(async () => {
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      const comma = dataUrl.indexOf(",");
      const bin = atob(dataUrl.slice(comma + 1));
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return new Blob([out], { type: "image/jpeg" });
    });
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    bitmap.close();
  }
}

/** Object URL for previewing an image in the UI. Caller revokes when done. */
export function imagePreviewUrl(bytes: Uint8Array, name: string): string {
  return URL.createObjectURL(bytesToBlob(bytes, mimeFromName(name)));
}
