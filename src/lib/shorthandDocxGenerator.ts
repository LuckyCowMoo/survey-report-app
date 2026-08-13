/**
 * Builds a Report-and-Run-style shorthand .docx that our parser can re-import:
 *   (N)
 *   [photo]
 *   Created:
 *   <date>
 *   <note lines>
 *   ...
 *   Kind Regards
 */
import {
  Document,
  ImageRun,
  Packer,
  Paragraph,
  TextRun
} from "docx";
import type { ShorthandEntry } from "../types";

const FONT = "Calibri";
const SIZE = 22;

function para(text: string, bold = false): Paragraph {
  return new Paragraph({
    spacing: { after: 80 },
    children: [
      new TextRun({
        text,
        bold,
        font: FONT,
        size: SIZE
      })
    ]
  });
}

function emptyPara(): Paragraph {
  return new Paragraph({ children: [] });
}

function imagePara(bytes: Uint8Array, name: string): Paragraph {
  const lower = name.toLowerCase();
  const type = lower.endsWith(".png") ? "png" : "jpg";
  // Reasonable on-page size; parser only cares that an image exists.
  const width = 480;
  const height = 360;
  return new Paragraph({
    spacing: { after: 120 },
    children: [
      new ImageRun({
        data: bytes,
        type,
        transformation: { width, height }
      })
    ]
  });
}

export async function generateShorthandDocx(
  entries: ShorthandEntry[]
): Promise<Blob> {
  const children: Paragraph[] = [];

  for (const entry of entries) {
    children.push(para(`(${entry.number})`));
    const img = entry.images[0];
    const imgName = entry.imageNames[0] ?? `image${entry.number}.jpeg`;
    if (img && img.byteLength > 0) {
      children.push(imagePara(img, imgName));
    }
    children.push(para("Created:"));
    if (entry.created.trim()) {
      children.push(para(entry.created.trim()));
    }
    const note = entry.note.replace(/\r\n/g, "\n").trim();
    if (note) {
      for (const line of note.split("\n")) {
        children.push(para(line));
      }
    }
    children.push(emptyPara());
  }

  children.push(para("Kind Regards"));

  const doc = new Document({
    sections: [
      {
        properties: {},
        children
      }
    ]
  });

  return Packer.toBlob(doc);
}

export function shorthandDocxFileName(addressHint = ""): string {
  const base =
    addressHint
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "")
      .replace(/\s+/g, " ")
      .slice(0, 48) || "field-notes";
  return `${base} shorthand.docx`;
}
