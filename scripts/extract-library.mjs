/**
 * One-off extraction tool: pulls every paragraph of text out of the template
 * .docx (and optionally any other .docx) so the curated content library in
 * src/data/content-library.json can be built / refreshed from it.
 *
 * Usage:  node scripts/extract-library.mjs [path-to-docx]
 * Output: scripts/extracted/<name>-paragraphs.json  (array of strings)
 */
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";

const input = process.argv[2] ?? "samples/template.docx";
const outDir = path.join("scripts", "extracted");

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) =>
      String.fromCodePoint(parseInt(n, 16))
    );
}

async function main() {
  const buf = fs.readFileSync(input);
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file("word/document.xml").async("string");

  // Split on paragraph close tags, then strip all remaining markup from each
  // chunk. Tabs and line breaks inside a paragraph become plain whitespace.
  const paragraphs = xml
    .split(/<\/w:p>/)
    .map((chunk) =>
      decodeEntities(
        chunk
          .replace(/<w:tab[^>]*\/>/g, " ")
          .replace(/<w:br[^>]*\/>/g, "\n")
          .replace(/<[^>]+>/g, "")
      )
        .replace(/[ \t]+/g, " ")
        .trim()
    )
    .filter((t) => t.length > 0);

  fs.mkdirSync(outDir, { recursive: true });
  const name = path.basename(input, path.extname(input));
  const outFile = path.join(outDir, `${name}-paragraphs.json`);
  fs.writeFileSync(outFile, JSON.stringify(paragraphs, null, 2), "utf8");
  console.log(`Extracted ${paragraphs.length} paragraphs -> ${outFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
