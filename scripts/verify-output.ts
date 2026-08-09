/**
 * Structural sanity check on the generated docx: XML well-formedness and
 * image relationship integrity for the document, header and footer parts.
 * Run with: npx tsx scripts/verify-output.ts [path]
 */
import fs from "node:fs";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

const file = process.argv[2] ?? "test-output/report.docx";
const zip = await JSZip.loadAsync(fs.readFileSync(file));
const parser = new XMLParser({ ignoreAttributes: false });

let failed = 0;

const parts = Object.keys(zip.files).filter((f) => f.endsWith(".xml") || f.endsWith(".rels"));
for (const p of parts) {
  const content = await zip.file(p)!.async("string");
  try {
    parser.parse(content);
  } catch (err) {
    console.error(`MALFORMED XML in ${p}: ${(err as Error).message}`);
    failed++;
  }
}
console.log(`Parsed ${parts.length} XML parts.`);

// Every r:embed in a part must have a matching relationship in its .rels.
async function checkRels(partPath: string) {
  const xml = await zip.file(partPath)!.async("string");
  const embeds = [...xml.matchAll(/r:embed="([^"]+)"/g)].map((m) => m[1]);
  if (embeds.length === 0) return;
  const dir = partPath.substring(0, partPath.lastIndexOf("/"));
  const name = partPath.substring(partPath.lastIndexOf("/") + 1);
  const relsPath = `${dir}/_rels/${name}.rels`;
  const relsFile = zip.file(relsPath);
  if (!relsFile) {
    console.error(`${partPath}: has images but no rels part ${relsPath}`);
    failed++;
    return;
  }
  const rels = await relsFile.async("string");
  for (const id of embeds) {
    const m = new RegExp(`Id="${id}"[^>]*Target="([^"]+)"`).exec(rels);
    if (!m) {
      console.error(`${partPath}: rel ${id} not found in ${relsPath}`);
      failed++;
      continue;
    }
    const target = m[1].replace(/^\//, "");
    const resolved = target.startsWith("media/") ? `word/${target}` : target;
    if (!zip.file(resolved)) {
      console.error(`${partPath}: rel ${id} target ${resolved} missing from package`);
      failed++;
    }
  }
  console.log(`${partPath}: ${embeds.length} image refs OK`);
}

for (const p of Object.keys(zip.files)) {
  if (/word\/(document|header\d+|footer\d+)\.xml$/.test(p)) {
    await checkRels(p);
  }
}

if (failed === 0) {
  console.log("STRUCTURE CHECK PASSED");
} else {
  console.error("STRUCTURE CHECK FAILED");
  process.exit(1);
}
