/**
 * End-to-end pipeline check without the browser or AI:
 *   shorthand.docx -> parser -> matcher -> generator -> test-output/report.docx
 * Then re-extracts the text of the generated file as a sanity check.
 * Run with: npx tsx scripts/test-e2e.ts
 */
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { parseShorthandDocx } from "../src/lib/docxParser";
import { matchEntries } from "../src/lib/matcher";
import { generateReportBuffer } from "../src/lib/docxGenerator";
import { getImageDims, mimeFromName, type DocImage } from "../src/lib/imageUtils";
import type { ReportExtras, ReportMetadata } from "../src/types";

const input = process.argv[2] ?? "samples/shorthand.docx";
const outDir = "test-output";

const buf = fs.readFileSync(input);
const { entries, warnings } = await parseShorthandDocx(new Uint8Array(buf));
console.log(`Parsed ${entries.length} entries (${warnings.length} warnings).`);

const sections = matchEntries(entries);
for (const s of sections) {
  const tag = s.needsAttention ? "NEEDS ATTENTION" : "ok";
  const what =
    s.source === "library"
      ? `library:${s.libraryId}`
      : s.source === "manual"
        ? "surveyor prose"
        : s.source;
  console.log(
    `(${s.entry.number}) [${tag}] ${what}${s.headingLine ? ` heading="${s.headingLine}"` : ""}`
  );
}

// Prepare images without canvas: raw bytes + header-parsed dimensions.
const images = new Map<number, DocImage>();
for (const e of entries) {
  if (e.images.length === 0) continue;
  const dims = getImageDims(e.images[0]);
  if (!dims) {
    console.warn(`(${e.number}) could not read image dimensions, skipping image.`);
    continue;
  }
  const mime = mimeFromName(e.imageNames[0]);
  images.set(e.number, {
    bytes: e.images[0],
    width: dims.width,
    height: dims.height,
    type: mime === "image/png" ? "png" : "jpg"
  });
}

const metadata: ReportMetadata = {
  companyName: "DampMaster",
  website: "www.dampmaster.com",
  propertyAddress: "Copthorne Hotel, Cardiff",
  clientName: "Test Client",
  propertyType: "detached commercial hotel",
  surveyDate: "6 August 2026",
  weatherDesc: "dry conditions",
  temperature: "18",
  skyDesc: "intermittent cloud cover"
};

const extras: ReportExtras = {
  dampIssues: { risingDamp: false, penetratingDamp: true, condensation: true },
  recommendationIds: ["rec-external-render", "rec-external-pointing", "rec-piv"],
  projectPlanLines: "Conference room: all exterior walls from floor to 1.2 meters",
  costLines: [
    {
      id: "1",
      itemId: "cost-strip-walls",
      description:
        "The first stage of the damp proofing process involves stripping back the walls to the original brick or substrate by removing all existing plaster and render to the required height.",
      amount: "575"
    },
    {
      id: "2",
      itemId: "cost-piv-unit",
      description: "The supply and fitting of Positive Input Ventilation (PIV) units in the property.",
      amount: "1350"
    }
  ],
  surveyDiscount: "238.80",
  timeEstimate: "5-6 days"
};

const bytes = await generateReportBuffer({ sections, metadata, extras, images });
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, "report.docx");
fs.writeFileSync(outFile, bytes);
console.log(`\nGenerated ${outFile} (${(bytes.length / 1024 / 1024).toFixed(2)} MB)`);

// Sanity check: unzip the produced file and confirm expected text exists.
const zip = await JSZip.loadAsync(bytes);
const xml = await zip.file("word/document.xml")!.async("string");
const text = xml.replace(/<[^>]+>/g, " ");
const mustContain = [
  "Damp Survey Report",
  "Copthorne Hotel, Cardiff",
  "INTRODUCTION",
  "(1)",
  `(${entries.length})`,
  "Penetrating Damp is an issue in this property",
  "Recommendations",
  "Total:",
  "Limitations of the Non-Invasive Damp and Timber Survey"
];
let failed = 0;
for (const needle of mustContain) {
  if (!text.includes(needle)) {
    console.error(`MISSING from output: ${JSON.stringify(needle)}`);
    failed++;
  }
}
const imageCount = Object.keys(zip.files).filter(
  (f) => f.startsWith("word/media/") && !zip.files[f].dir
).length;
console.log(`Embedded images in output: ${imageCount} (expected ${images.size})`);
if (failed === 0 && imageCount === images.size) {
  console.log("E2E CHECK PASSED");
} else {
  console.error("E2E CHECK FAILED");
  process.exit(1);
}
