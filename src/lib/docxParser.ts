/**
 * Parser for the surveyor's shorthand .docx.
 *
 * The shorthand document is a flat sequence of numbered photo entries:
 *   (1)  [photo]  Created: <date>  <optional note text>
 *   (2)  ...
 *
 * OOXML paragraphs (w:p) never nest, even inside tables, so walking the raw
 * document.xml paragraph-by-paragraph preserves reading order. For each
 * paragraph we pull out the visible text (w:t runs) and any image references
 * (a:blip r:embed / v:imagedata r:id), then run a small state machine over
 * the sequence keyed on the "(N)" marker paragraphs.
 *
 * Pure JS (jszip only) so the same module runs in the browser and in Node
 * test scripts.
 */
import JSZip from "jszip";
import type { ShorthandEntry } from "../types";

export interface ParsedShorthand {
  entries: ShorthandEntry[];
  warnings: string[];
}

const ENTRY_MARKER = /^\((\d{1,3})\)$/;
const FILENAME_LINE = /^[\w\- ()]+\.(jpe?g|png|gif|heic|heif|bmp|tiff?)$/i;
const SIGNOFF_LINE = /^(kind\s+|best\s+|warm\s+)?(regards|wishes|thanks)[,.!]?$/i;

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

/** Extract visible text from one w:p chunk. */
function paragraphText(chunk: string): string {
  const texts: string[] = [];
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(chunk)) !== null) {
    texts.push(decodeEntities(m[1]));
  }
  // Tabs render as separators between runs.
  return texts.join("").replace(/\s+/g, " ").trim();
}

/** Extract image relationship ids from one w:p chunk, in order. */
function paragraphImageRels(chunk: string): string[] {
  const ids: string[] = [];
  const re = /(?:a:blip[^>]*\br:embed|v:imagedata[^>]*\br:id)="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(chunk)) !== null) {
    ids.push(m[1]);
  }
  return ids;
}

export async function parseShorthandDocx(
  data: ArrayBuffer | Uint8Array
): Promise<ParsedShorthand> {
  const warnings: string[] = [];
  const zip = await JSZip.loadAsync(data);

  const docFile = zip.file("word/document.xml");
  if (!docFile) {
    throw new Error(
      "This file does not look like a Word document (missing word/document.xml)."
    );
  }
  const xml = await docFile.async("string");

  // Relationship id -> media path inside the zip.
  const relMap = new Map<string, string>();
  const relsFile = zip.file("word/_rels/document.xml.rels");
  if (relsFile) {
    const relsXml = await relsFile.async("string");
    const relRe = /<Relationship\s[^>]*>/g;
    let rm: RegExpExecArray | null;
    while ((rm = relRe.exec(relsXml)) !== null) {
      const tag = rm[0];
      const id = /\bId="([^"]+)"/.exec(tag)?.[1];
      const target = /\bTarget="([^"]+)"/.exec(tag)?.[1];
      if (id && target && /media\//i.test(target)) {
        const path = target.replace(/^\/?(word\/)?/, "word/");
        relMap.set(id, path);
      }
    }
  }

  // Walk paragraphs in document order.
  const chunks = xml.split(/<\/w:p>/);
  interface WorkingEntry {
    number: number;
    noteLines: string[];
    created: string;
    imageRels: string[];
  }
  const working: WorkingEntry[] = [];
  let current: WorkingEntry | null = null;
  let awaitingDate = false;

  for (const chunk of chunks) {
    const text = paragraphText(chunk);
    const rels = paragraphImageRels(chunk);

    const marker = ENTRY_MARKER.exec(text);
    if (marker) {
      current = {
        number: Number(marker[1]),
        noteLines: [],
        created: "",
        imageRels: []
      };
      working.push(current);
      awaitingDate = false;
      continue;
    }

    if (!current) continue; // preamble before the first entry

    if (rels.length > 0) current.imageRels.push(...rels);
    if (text.length === 0) continue;

    if (/^Created:?$/i.test(text)) {
      awaitingDate = true;
      continue;
    }
    const createdInline = /^Created:\s*(.+)$/i.exec(text);
    if (createdInline) {
      current.created = createdInline[1].trim();
      awaitingDate = false;
      continue;
    }
    if (awaitingDate) {
      current.created = text;
      awaitingDate = false;
      continue;
    }
    if (FILENAME_LINE.test(text)) continue; // image filename captions
    if (SIGNOFF_LINE.test(text)) continue; // e.g. trailing "Kind Regards"

    current.noteLines.push(text);
  }

  // Resolve image bytes.
  const entries: ShorthandEntry[] = [];
  for (const w of working) {
    const images: Uint8Array[] = [];
    const imageNames: string[] = [];
    for (const rel of w.imageRels) {
      const path = relMap.get(rel);
      if (!path) {
        warnings.push(`Entry (${w.number}): image relationship ${rel} not found.`);
        continue;
      }
      const file = zip.file(path);
      if (!file) {
        warnings.push(`Entry (${w.number}): media file ${path} missing from document.`);
        continue;
      }
      images.push(await file.async("uint8array"));
      imageNames.push(path.split("/").pop() ?? path);
    }
    if (images.length === 0) {
      warnings.push(`Entry (${w.number}) has no photo.`);
    }
    entries.push({
      number: w.number,
      note: w.noteLines.join("\n").trim(),
      created: w.created,
      imageNames,
      images
    });
  }

  if (entries.length === 0) {
    throw new Error(
      "No numbered photo entries like (1), (2) were found in this document. " +
        "Check that you selected the shorthand survey file."
    );
  }

  return { entries, warnings };
}
