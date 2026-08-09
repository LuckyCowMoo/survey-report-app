/**
 * Spot checks for ambiguous-keyword disambiguation in the matcher.
 * Run with: npx tsx scripts/test-matcher-cases.ts
 */
import { matchEntries } from "../src/lib/matcher";
import type { ShorthandEntry } from "../src/types";

const cases: Array<{ note: string; expectId: string; expectCertain: boolean }> = [
  { note: "999", expectId: "reading-999-saturation", expectCertain: true },
  { note: "999 masonry", expectId: "reading-999-resistance", expectCertain: true },
  { note: "999 brick wall", expectId: "reading-999-resistance", expectCertain: true },
  { note: "air quality", expectId: "air-quality-high-humidity", expectCertain: false },
  { note: "air quality no issues", expectId: "air-quality-no-issues", expectCertain: true },
  { note: "air quality ok", expectId: "air-quality-no-issues", expectCertain: true },
  { note: "thermal", expectId: "thermal-walls-damp", expectCertain: false },
  { note: "thermal ceiling", expectId: "thermal-ceiling-mould", expectCertain: true },
  { note: "thermal heat loss", expectId: "thermal-heat-loss", expectCertain: true },
  { note: "thermal walls", expectId: "thermal-walls-damp", expectCertain: true },
  { note: "rh 65%", expectId: "rh-high", expectCertain: true },
  { note: "rh 40%", expectId: "rh-low", expectCertain: true },
  { note: "pin skirting", expectId: "steel-pins-skirting", expectCertain: true },
  { note: "pin", expectId: "steel-pins-doorframe", expectCertain: false }
];

let failed = 0;
for (const c of cases) {
  const entry: ShorthandEntry = {
    number: 1,
    note: c.note,
    created: "",
    imageNames: [],
    images: []
  };
  const [s] = matchEntries([entry]);
  const okId = s.libraryId === c.expectId;
  const okFlag = s.needsAttention === !c.expectCertain;
  if (!okId || !okFlag) {
    console.error(
      `FAIL "${c.note}": got ${s.libraryId} (flagged=${s.needsAttention}), ` +
        `expected ${c.expectId} (flagged=${!c.expectCertain})`
    );
    failed++;
  } else {
    console.log(`ok   "${c.note}" -> ${s.libraryId}${s.needsAttention ? " (flagged)" : ""}`);
  }
}

if (failed > 0) {
  console.error(`${failed} case(s) failed`);
  process.exit(1);
}
console.log("MATCHER CASES PASSED");
