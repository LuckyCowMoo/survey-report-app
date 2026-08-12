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
  skyDesc: "intermittent cloud cover",
  contactName: "David Reed",
  phone: "07399 364953",
  email: "d.reed@dampmaster.com",
  docId: "112.1"
};

const extras: ReportExtras = {
  dampIssues: {
    risingDamp: false,
    penetratingDamp: true,
    condensation: true,
    other: false
  },
  otherIssueText: "",
  recommendationIds: ["rec-external-render", "rec-external-pointing", "rec-piv"],
  otherRecommendation: false,
  otherRecommendationText: "",
  projectPlanLines: "Conference room: all exterior walls from floor to 1.2 meters",
  costLines: [
    {
      id: "1",
      itemId: "cost-strip-walls",
      label: "Strip walls back to substrate",
      description:
        "The first stage of the damp proofing process involves stripping back the walls to the original brick or substrate by removing all existing plaster and render to the required height.",
      amount: "575"
    },
    {
      id: "2",
      itemId: "cost-piv-unit",
      label: "PIV units",
      description: "The supply and fitting of Positive Input Ventilation (PIV) units in the property.",
      amount: "1350"
    }
  ],
  otherCost: false,
  otherCostDescription: "",
  otherCostAmount: "",
  surveyDiscount: "238.80",
  timeEstimate: "5-6 days",
  excludePlanCosts: false,
  aiSuggested: {
    issues: { risingDamp: false, penetratingDamp: false, condensation: false },
    issueReasons: {},
    recommendationIds: [],
    recommendationReasons: {},
    costItemIds: [],
    costReasons: {}
  }
};

const bytes = await generateReportBuffer({ sections, metadata, extras, images });
fs.mkdirSync(outDir, { recursive: true });
// Optional second arg: output file name (useful when report.docx is open in Word).
const outFile = path.join(outDir, process.argv[3] ?? "report.docx");
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
// Layout checks: blue services paragraph, bold skirting note, entry tables.
if (!/<w:color w:val="0070C0"\/>/.test(xml)) {
  console.error("MISSING: blue (0070C0) services paragraph");
  failed++;
}
const skirtIdx = xml.indexOf("new skirting boards");
const skirtChunk = xml.slice(xml.lastIndexOf("<w:p>", skirtIdx), skirtIdx);
if (!skirtChunk.includes("<w:b/>")) {
  console.error("MISSING: bold formatting on the skirting-boards note");
  failed++;
}
if (!xml.includes("<w:tbl>")) {
  console.error("MISSING: entry layout tables");
  failed++;
}

// Header/footer present and populated.
const files = Object.keys(zip.files);
const headerFile = files.find((f) => /word\/header\d+\.xml/.test(f));
const footerFile = files.find((f) => /word\/footer\d+\.xml/.test(f));
if (!headerFile || !footerFile) {
  console.error("MISSING: header/footer parts in the package");
  failed++;
} else {
  const headerXml = await zip.file(headerFile)!.async("string");
  const footerXml = await zip.file(footerFile)!.async("string");
  for (const needle of ["Created:", "Contact:", "Company:", "Phone:", "Email:", "No. Items:"]) {
    if (!headerXml.includes(needle)) {
      console.error(`MISSING from header: ${JSON.stringify(needle)}`);
      failed++;
    }
  }
  if (!headerXml.includes("<w:drawing>")) {
    console.error("MISSING: logo image in header");
    failed++;
  }
  if (!footerXml.includes("NUMPAGES") || !footerXml.includes("Doc. Id.: 112.1")) {
    console.error("MISSING: page numbering / doc id in footer");
    failed++;
  }
  if (!footerXml.includes("<w:drawing>")) {
    console.error("MISSING: logo image in footer");
    failed++;
  }
}
if (!xml.includes("<w:titlePg/>")) {
  console.error("MISSING: title-page flag (cover should have no header/footer)");
  failed++;
}

// Photos + cover logo + finance graphic + header logo + footer logo.
const expectedImages = images.size + 4;
const imageCount = files.filter(
  (f) => f.startsWith("word/media/") && !zip.files[f].dir
).length;
console.log(`Embedded images in output: ${imageCount} (expected ${expectedImages})`);
if (failed === 0 && imageCount === expectedImages) {
  console.log("E2E CHECK PASSED");
} else {
  console.error("E2E CHECK FAILED");
  process.exit(1);
}
