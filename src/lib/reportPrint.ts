import { library } from "./matcher";
import type { ReportExtras, ReportMetadata, SectionState } from "../types";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function recLabel(id: string): string {
  const r = library.recommendations.find((x) => x.id === id);
  return r?.label ?? id;
}

function costLabel(id: string): string {
  const c = library.costItems.find((x) => x.id === id);
  return c?.label ?? id;
}

function sectionHtml(section: SectionState): string {
  const title =
    section.headingLine.trim() ||
    `Photo ${section.entry.number}` +
      (section.entry.note.trim() ? ` — ${section.entry.note.trim()}` : "");
  const img = section.entry.images[0];
  const name = section.entry.imageNames[0] ?? "photo.jpg";
  let imgTag = "";
  if (img) {
    const mime = name.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
    const b64 = bytesToBase64(img);
    imgTag = `<img class="photo" src="data:${mime};base64,${b64}" alt="" />`;
  }
  const body = section.text.trim()
    ? `<p>${esc(section.text).replace(/\n+/g, "</p><p>")}</p>`
    : `<p class="muted">(No wording yet)</p>`;
  return `<section class="entry"><h2>${esc(title)}</h2>${imgTag}${body}</section>`;
}

/** Build a print-ready HTML document for Save as PDF. */
export function buildReportPrintHtml(input: {
  sections: SectionState[];
  metadata: ReportMetadata;
  extras: ReportExtras;
}): string {
  const { metadata: m, extras, sections } = input;
  const issues: string[] = [];
  if (extras.dampIssues.risingDamp) issues.push("Rising damp");
  if (extras.dampIssues.penetratingDamp) issues.push("Penetrating damp");
  if (extras.dampIssues.condensation) issues.push("Condensation");
  if (extras.dampIssues.other && extras.otherIssueText.trim()) {
    issues.push(extras.otherIssueText.trim());
  }

  const recs = [
    ...extras.recommendationIds.map(recLabel),
    ...(extras.otherRecommendation && extras.otherRecommendationText.trim()
      ? [extras.otherRecommendationText.trim()]
      : [])
  ];
  const costs = [
    ...extras.costLines.map((line) => {
      const bits = [line.label || costLabel(line.itemId)];
      if (line.amount.trim()) bits.push(line.amount.trim());
      if (line.location?.trim()) bits.push(`(${line.location.trim()})`);
      return bits.join(" — ");
    }),
    ...(extras.otherCost && extras.otherCostDescription.trim()
      ? [
          [
            extras.otherCostDescription.trim(),
            extras.otherCostAmount.trim()
          ]
            .filter(Boolean)
            .join(" — ")
        ]
      : [])
  ];

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${esc(m.propertyAddress || "Damp and Timber Survey")}</title>
<style>
  @page { margin: 14mm; }
  body { font-family: Georgia, "Times New Roman", serif; color: #1a1a1a; line-height: 1.45; font-size: 11pt; }
  h1 { font-size: 18pt; margin: 0 0 6px; }
  h2 { font-size: 13pt; margin: 18px 0 8px; page-break-after: avoid; }
  .meta { color: #444; font-size: 10pt; margin-bottom: 18px; }
  .entry { break-inside: avoid; page-break-inside: avoid; margin-bottom: 16px; }
  .photo { display: block; max-width: 100%; max-height: 280px; margin: 8px 0 10px; object-fit: contain; }
  ul { padding-left: 1.2em; }
  .muted { color: #777; }
  @media print {
    .no-print { display: none !important; }
  }
</style>
</head>
<body>
  <p class="no-print muted">Use your browser’s print dialog and choose <strong>Save as PDF</strong> / <strong>Microsoft Print to PDF</strong>.</p>
  <h1>Damp and Timber Survey</h1>
  <div class="meta">
    <div><strong>${esc(m.companyName || "Survey report")}</strong>${m.website ? ` · ${esc(m.website)}` : ""}</div>
    <div>Property: ${esc(m.propertyAddress || "(not set)")}</div>
    <div>Client: ${esc(m.clientName || "(not set)")}</div>
    <div>Survey date: ${esc(m.surveyDate || "(not set)")}</div>
  </div>
  ${sections.map(sectionHtml).join("\n")}
  ${
    issues.length
      ? `<h2>Damp issues</h2><ul>${issues.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`
      : ""
  }
  ${
    recs.length
      ? `<h2>Recommendations</h2><ul>${recs.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>`
      : ""
  }
  ${
    costs.length
      ? `<h2>Costs</h2><ul>${costs.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>`
      : ""
  }
  <script>
    window.onload = function () {
      setTimeout(function () { window.print(); }, 250);
    };
  </script>
</body>
</html>`;
}

/** Open a print window so the user can Save as PDF. */
export function openReportPrintDialog(input: {
  sections: SectionState[];
  metadata: ReportMetadata;
  extras: ReportExtras;
}): void {
  const html = buildReportPrintHtml(input);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank", "noopener,noreferrer");
  if (!win) {
    URL.revokeObjectURL(url);
    throw new Error(
      "Pop-up blocked — allow pop-ups for this site to save a PDF, or try Download again."
    );
  }
  // Revoke after the new document has had time to load.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
