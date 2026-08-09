/**
 * Pulls the branding assets (cover logo, header/footer logos, finance
 * graphic) out of the example report docx and embeds them as base64 in
 * src/data/assets.ts so the generator can use them in any environment.
 *
 * Run with: node scripts/embed-assets.mjs [path-to-example-docx]
 */
import fs from "node:fs";
import JSZip from "jszip";

const input = process.argv[2] ?? "samples/example.docx";

// Display dimensions (px at 96dpi) taken from the example document's XML.
const ASSETS = [
  { key: "coverLogo", file: "word/media/image1.png", width: 691, height: 251, type: "png" },
  { key: "headerLogo", file: "word/media/image49.jpg", width: 96, height: 35, type: "jpg" },
  { key: "footerLogo", file: "word/media/image50.jpg", width: 96, height: 24, type: "jpg" },
  { key: "financeImage", file: "word/media/image48.png", width: 551, height: 138, type: "png" }
];

const zip = await JSZip.loadAsync(fs.readFileSync(input));

let out = `/**
 * Branding assets extracted from the firm's example report document by
 * scripts/embed-assets.mjs - do not edit by hand; re-run the script if the
 * branding changes. Dimensions are display sizes in px (96dpi) matching the
 * example document.
 */

export interface EmbeddedAsset {
  base64: string;
  width: number;
  height: number;
  type: "png" | "jpg";
}

`;

for (const a of ASSETS) {
  const file = zip.file(a.file);
  if (!file) {
    console.error(`Missing ${a.file} in ${input}`);
    process.exit(1);
  }
  const b64 = Buffer.from(await file.async("uint8array")).toString("base64");
  const name = a.key.replace(/([A-Z])/g, "_$1").toUpperCase();
  out += `export const ${name}: EmbeddedAsset = {\n  base64:\n    "${b64}",\n  width: ${a.width},\n  height: ${a.height},\n  type: "${a.type}"\n};\n\n`;
  console.log(`${a.key}: ${a.file} (${Math.round(b64.length / 1024)} KB base64)`);
}

fs.writeFileSync("src/data/assets.ts", out, "utf8");
console.log("Wrote src/data/assets.ts");
