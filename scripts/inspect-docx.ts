/**
 * Dev utility: print a text-presence check and image count for any .docx.
 * Run with: npx tsx scripts/inspect-docx.ts <path> [needle1] [needle2] ...
 */
import fs from "node:fs";
import JSZip from "jszip";

const [, , file, ...needles] = process.argv;
if (!file) {
  console.error("Usage: tsx scripts/inspect-docx.ts <path> [needles...]");
  process.exit(1);
}

const zip = await JSZip.loadAsync(fs.readFileSync(file));
const xml = await zip.file("word/document.xml")!.async("string");
const text = xml.replace(/<[^>]+>/g, " ");

for (const n of needles) {
  console.log(text.includes(n) ? "FOUND   " : "MISSING ", n);
}
const media = Object.keys(zip.files).filter(
  (f) => f.startsWith("word/media/") && !zip.files[f].dir
);
console.log("images:", media.length);
