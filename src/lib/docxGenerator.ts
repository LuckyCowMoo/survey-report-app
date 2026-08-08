/**
 * Builds the finished survey report .docx, mirroring the layout of the firm's
 * completed example: cover page, contents, introduction, numbered photo
 * sections, damp-type explainers, recommendations, costed project plan and
 * limitations.
 */
import {
  AlignmentType,
  Document,
  ImageRun,
  PageBreak,
  Packer,
  Paragraph,
  TextRun
} from "docx";
import {
  CONTENTS_SECTIONS,
  COST_FOOTNOTES,
  INTRO_BLOCKS,
  LIMITATIONS_TITLE,
  PROJECT_PLAN_HEADING,
  SERVICES_FULL,
  SERVICES_INTRO,
  fillPlaceholders
} from "../data/boilerplate";
import { library } from "./matcher";
import type { DocImage } from "./imageUtils";
import type { ReportExtras, ReportMetadata, SectionState } from "../types";

export interface ReportInput {
  sections: SectionState[];
  metadata: ReportMetadata;
  extras: ReportExtras;
  /** Prepared (compressed) images keyed by entry number. */
  images: Map<number, DocImage>;
}

const FONT = "Calibri";
/** Usable content width in pixels at 96dpi for A4 with 1" margins. */
const MAX_IMAGE_WIDTH = 560;
const MAX_IMAGE_HEIGHT = 620;

function body(text: string, opts: { bold?: boolean; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {}): Paragraph {
  return new Paragraph({
    alignment: opts.align ?? AlignmentType.JUSTIFIED,
    spacing: { after: 160 },
    children: [new TextRun({ text, bold: opts.bold, font: FONT, size: 22 })]
  });
}

function heading(text: string, size = 32): Paragraph {
  return new Paragraph({
    spacing: { before: 240, after: 200 },
    children: [new TextRun({ text, bold: true, font: FONT, size })]
  });
}

function centered(text: string, size: number, bold = true): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [new TextRun({ text, bold, font: FONT, size })]
  });
}

function pageBreak(): Paragraph {
  return new Paragraph({ children: [new PageBreak()] });
}

function multiParagraph(text: string): Paragraph[] {
  return text
    .split(/\n+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map((t) => body(t));
}

function bulletParagraphs(text: string): Paragraph[] {
  const parts = text.split(/\n+/).filter((t) => t.trim().length > 0);
  return parts.map(
    (t, i) =>
      new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        spacing: { after: i === parts.length - 1 ? 200 : 80 },
        indent: { left: 360, hanging: i === 0 ? 360 : 0 },
        children: [
          new TextRun({
            text: (i === 0 ? "•    " : "") + t.trim(),
            font: FONT,
            size: 22
          })
        ]
      })
  );
}

function imageParagraph(img: DocImage): Paragraph {
  const scale = Math.min(
    1,
    MAX_IMAGE_WIDTH / img.width,
    MAX_IMAGE_HEIGHT / img.height
  );
  const width = Math.round(img.width * scale);
  const height = Math.round(img.height * scale);
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 120, after: 120 },
    children: [
      new ImageRun({
        data: img.bytes,
        type: img.type,
        transformation: { width, height }
      })
    ]
  });
}

function coverPage(meta: ReportMetadata): Paragraph[] {
  return [
    new Paragraph({ spacing: { after: 2000 }, children: [] }),
    centered("Damp Survey Report", 72),
    new Paragraph({ spacing: { after: 800 }, children: [] }),
    centered(`Property Address: ${meta.propertyAddress}`, 32, true),
    meta.surveyDate ? centered(`Survey date: ${meta.surveyDate}`, 26, false) : null,
    new Paragraph({ spacing: { after: 1600 }, children: [] }),
    centered(meta.website, 28, false),
    pageBreak()
  ].filter((p): p is Paragraph => p !== null);
}

function contentsPage(): Paragraph[] {
  const out: Paragraph[] = [heading("CONTENTS", 36)];
  for (const s of CONTENTS_SECTIONS) {
    out.push(body(s.title, { bold: true, align: AlignmentType.LEFT }));
    out.push(body(s.blurb));
  }
  out.push(pageBreak());
  return out;
}

function introductionPage(meta: ReportMetadata): Paragraph[] {
  const values: Record<string, string> = {
    company_name: meta.companyName,
    client_name: meta.clientName,
    property_type: meta.propertyType,
    weather_desc: meta.weatherDesc,
    temperature: meta.temperature,
    sky_desc: meta.skyDesc
  };
  const out: Paragraph[] = [heading("INTRODUCTION", 36)];
  const blocks: Array<[string, string]> = [
    ["Client Request:", INTRO_BLOCKS.clientRequest],
    ["Objective of Assessment and Inspection:", INTRO_BLOCKS.objective],
    ["Property Description:", INTRO_BLOCKS.propertyDescription],
    ["Report Overview:", INTRO_BLOCKS.reportOverview],
    ["Weather Conditions During Survey:", INTRO_BLOCKS.weather]
  ];
  for (const [label, template] of blocks) {
    out.push(body(label, { bold: true, align: AlignmentType.LEFT }));
    out.push(body(fillPlaceholders(template, values)));
  }
  out.push(pageBreak());
  return out;
}

function photoSections(
  sections: SectionState[],
  images: Map<number, DocImage>
): Paragraph[] {
  const out: Paragraph[] = [heading("INSPECTION DETAILS, OBSERVATIONS & FINDINGS", 32)];
  for (const s of sections) {
    out.push(
      new Paragraph({
        spacing: { before: 240, after: 60 },
        children: [
          new TextRun({ text: `(${s.entry.number})`, bold: true, font: FONT, size: 24 })
        ]
      })
    );
    const img = images.get(s.entry.number);
    if (img) out.push(imageParagraph(img));
    if (s.entry.created) {
      out.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 120 },
          children: [
            new TextRun({
              text: `Created: ${s.entry.created}`,
              italics: true,
              font: FONT,
              size: 18
            })
          ]
        })
      );
    }
    if (s.headingLine) {
      out.push(body(s.headingLine, { bold: true, align: AlignmentType.LEFT }));
    }
    if (s.text.trim().length > 0) {
      out.push(...multiParagraph(s.text));
    }
  }
  return out;
}

function dampTypePages(extras: ReportExtras): Paragraph[] {
  const enabled: Array<[string, boolean]> = [
    ["rising-damp", extras.dampIssues.risingDamp],
    ["penetrating-damp", extras.dampIssues.penetratingDamp],
    ["condensation", extras.dampIssues.condensation]
  ];
  const out: Paragraph[] = [];
  for (const [id, on] of enabled) {
    if (!on) continue;
    const dt = library.dampTypes.find((d) => d.id === id);
    if (!dt) continue;
    out.push(heading(dt.title, 30));
    for (const p of dt.paragraphs) out.push(body(p));
    out.push(centered(dt.flagLine, 24, true));
  }
  if (out.length > 0) out.unshift(pageBreak());
  return out;
}

function recommendationsPages(extras: ReportExtras): Paragraph[] {
  if (extras.recommendationIds.length === 0) return [];
  const out: Paragraph[] = [pageBreak(), heading("Recommendations", 32)];
  for (const id of extras.recommendationIds) {
    const rec = library.recommendations.find((r) => r.id === id);
    if (rec) out.push(...bulletParagraphs(rec.text));
  }
  return out;
}

function parseAmount(s: string): number | null {
  const m = /(\d+(?:[.,]\d+)?)/.exec(s.replace(/[£,\s]/g, ""));
  return m ? Number(m[1]) : null;
}

function costsPages(extras: ReportExtras, meta: ReportMetadata): Paragraph[] {
  if (extras.costLines.length === 0 && extras.projectPlanLines.trim() === "") {
    return [];
  }
  const out: Paragraph[] = [pageBreak()];
  out.push(
    body(fillPlaceholders(SERVICES_INTRO, { company_name: meta.companyName }))
  );
  out.push(heading(PROJECT_PLAN_HEADING, 26));
  if (extras.projectPlanLines.trim()) {
    for (const line of extras.projectPlanLines.split(/\n+/)) {
      if (line.trim()) out.push(body(line.trim(), { align: AlignmentType.LEFT }));
    }
  }

  let total = 0;
  let allNumeric = extras.costLines.length > 0;
  for (const line of extras.costLines) {
    const text = line.description.trim();
    if (!text) continue;
    const amount = line.amount.trim();
    const merged = `${text} Cost: £${amount || ""}`;
    out.push(...bulletParagraphs(merged));
    const n = parseAmount(amount);
    if (n === null) allNumeric = false;
    else total += n;
  }
  if (extras.costLines.length > 0) {
    out.push(
      body(allNumeric ? `Total: £${total} + VAT` : "Total: £", {
        bold: true,
        align: AlignmentType.LEFT
      })
    );
  }
  out.push(body(COST_FOOTNOTES.vatNote, { align: AlignmentType.LEFT }));
  if (extras.surveyDiscount.trim()) {
    out.push(
      body(`• -£${extras.surveyDiscount.trim()} Cost for survey if damp proofing work is completed`, {
        align: AlignmentType.LEFT
      })
    );
  }
  if (extras.timeEstimate.trim()) {
    out.push(
      body(`Time to complete the job estimated between ${extras.timeEstimate.trim()}`, {
        align: AlignmentType.LEFT
      })
    );
  }
  out.push(body(COST_FOOTNOTES.skirtingNote));
  out.push(body(COST_FOOTNOTES.financeNote, { bold: true, align: AlignmentType.LEFT }));
  out.push(body(COST_FOOTNOTES.contactNote, { align: AlignmentType.LEFT }));
  out.push(body(SERVICES_FULL));
  return out;
}

function limitationsPages(): Paragraph[] {
  const out: Paragraph[] = [pageBreak(), heading(LIMITATIONS_TITLE, 30)];
  for (const l of library.limitations) {
    out.push(body(l.heading, { bold: true, align: AlignmentType.LEFT }));
    out.push(body(l.text));
  }
  return out;
}

export function buildReportDocument(input: ReportInput): Document {
  const { sections, metadata, extras, images } = input;
  const children: Paragraph[] = [
    ...coverPage(metadata),
    ...contentsPage(),
    ...introductionPage(metadata),
    ...photoSections(sections, images),
    ...dampTypePages(extras),
    ...recommendationsPages(extras),
    ...costsPages(extras, metadata),
    ...limitationsPages()
  ];

  return new Document({
    styles: {
      default: {
        document: { run: { font: FONT, size: 22 } }
      }
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 }, // A4 in twips
            margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 }
          }
        },
        children
      }
    ]
  });
}

/** Browser: returns a Blob ready for download / share. */
export async function generateReportBlob(input: ReportInput): Promise<Blob> {
  return Packer.toBlob(buildReportDocument(input));
}

/** Node (tests): returns raw bytes. */
export async function generateReportBuffer(input: ReportInput): Promise<Uint8Array> {
  return Packer.toBuffer(buildReportDocument(input));
}

export function reportFileName(meta: ReportMetadata): string {
  const addr = meta.propertyAddress.trim().replace(/[^\w\s-]/g, "").replace(/\s+/g, " ");
  return `Damp and Timber Survey - ${addr || "Report"}.docx`;
}
