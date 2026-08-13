/**
 * Round-trip check: generate shorthand docx → parseShorthandDocx.
 * Run: npx tsx scripts/test-shorthand-roundtrip.ts
 */
import { parseShorthandDocx } from "../src/lib/docxParser";
import { generateShorthandDocx } from "../src/lib/shorthandDocxGenerator";
import type { ShorthandEntry } from "../src/types";

function tinyJpeg(): Uint8Array {
  // Minimal valid-ish JPEG (1x1) — parser only needs bytes present.
  const bin = atob(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z"
  );
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const sample: ShorthandEntry[] = [
  {
    number: 1,
    note: "front",
    created: "Thu, 8/6/2026",
    imageNames: ["image1.jpeg"],
    images: [tinyJpeg()]
  },
  {
    number: 2,
    note: "Pin reading\n7.0",
    created: "Thu, 8/6/2026",
    imageNames: ["image2.jpeg"],
    images: [tinyJpeg()]
  }
];

const blob = await generateShorthandDocx(sample);
const buf = new Uint8Array(await blob.arrayBuffer());
const { entries, warnings } = await parseShorthandDocx(buf);

let failed = false;
if (entries.length !== sample.length) {
  console.error(`Expected ${sample.length} entries, got ${entries.length}`);
  failed = true;
}
for (let i = 0; i < sample.length; i++) {
  const want = sample[i]!;
  const got = entries[i];
  if (!got) continue;
  if (got.number !== want.number) {
    console.error(`Entry ${i}: number ${got.number} !== ${want.number}`);
    failed = true;
  }
  if (got.created !== want.created) {
    console.error(`Entry ${i}: created ${JSON.stringify(got.created)} !== ${JSON.stringify(want.created)}`);
    failed = true;
  }
  if (got.note !== want.note) {
    console.error(`Entry ${i}: note ${JSON.stringify(got.note)} !== ${JSON.stringify(want.note)}`);
    failed = true;
  }
  if (got.images.length < 1) {
    console.error(`Entry ${i}: missing image`);
    failed = true;
  }
}

if (warnings.length) {
  console.log("Warnings:", warnings);
}

if (failed) {
  console.error("Round-trip FAILED");
  process.exit(1);
}
console.log(`Round-trip OK (${entries.length} entries)`);
