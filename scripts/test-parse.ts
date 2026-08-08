/**
 * Dev check: parse the real shorthand sample and print what we found.
 * Run with: npx tsx scripts/test-parse.ts [path-to-docx]
 */
import fs from "node:fs";
import { parseShorthandDocx } from "../src/lib/docxParser";

const input = process.argv[2] ?? "samples/shorthand.docx";

const buf = fs.readFileSync(input);
const { entries, warnings } = await parseShorthandDocx(new Uint8Array(buf));

console.log(`Parsed ${entries.length} entries from ${input}\n`);
for (const e of entries) {
  const note = e.note ? JSON.stringify(e.note.slice(0, 90)) : "(no note)";
  console.log(
    `(${e.number})  images=[${e.imageNames.join(", ")}]  created=${JSON.stringify(
      e.created
    )}\n      note=${note}${e.note.length > 90 ? "..." : ""}`
  );
}
if (warnings.length) {
  console.log("\nWarnings:");
  for (const w of warnings) console.log("  - " + w);
}
