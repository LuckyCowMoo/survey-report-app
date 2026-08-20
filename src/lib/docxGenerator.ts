/**
 * Builds the finished survey report .docx, mirroring the layout of the firm's
 * completed example: cover page with logo, header/footer on every page (except
 * the cover), contents, introduction, numbered photo sections laid out as
 * image-beside-text tables, damp-type explainers, recommendations, costed
 * project plan (with the finance graphic) and limitations.
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  ImageRun,
  PageBreak,
  PageNumber,
  Packer,
  Paragraph,
  Table,
  TableBorders,
  TableCell,
  TableRow,
  TextRun,
  UnderlineType,
  VerticalAlign,
  WidthType
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
import {
  INVASIVE_LIMITATIONS,
  INVASIVE_LIMITATIONS_TITLE
} from "../data/invasiveLimitations";
import {
  COVER_LOGO,
  FINANCE_IMAGE,
  FOOTER_LOGO,
  HEADER_LOGO,
  type EmbeddedAsset
} from "../data/assets";
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
/** Body text: 12pt, matching the example document's default. */
const BODY_SIZE = 24;
/** Contents page title + section titles: 14pt underlined. */
const CONTENTS_SIZE = 28;
/** Blue used for the services paragraph in the example. */
const SERVICES_BLUE = "0070C0";

// Photo cell in the entry table is 4892 twips wide with a 200 twip gutter;
// at 15 twips/px that gives ~312px of usable width. Height cap matches the
// example's portrait photos (~342px).
const ENTRY_IMAGE_MAX_WIDTH = 310;
const ENTRY_IMAGE_MAX_HEIGHT = 342;

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function assetRun(asset: EmbeddedAsset, width?: number, height?: number): ImageRun {
  return new ImageRun({
    data: base64ToBytes(asset.base64),
    type: asset.type,
    transformation: {
      width: width ?? asset.width,
      height: height ?? asset.height
    }
  });
}

function body(
  text: string,
  opts: {
    bold?: boolean;
    color?: string;
    align?: (typeof AlignmentType)[keyof typeof AlignmentType];
  } = {}
): Paragraph {
  return new Paragraph({
    alignment: opts.align ?? AlignmentType.LEFT,
    spacing: { after: 160 },
    children: [
      new TextRun({
        text,
        bold: opts.bold,
        color: opts.color,
        font: FONT,
        size: BODY_SIZE
      })
    ]
  });
}

function heading(text: string, size = 32): Paragraph {
  return new Paragraph({
    spacing: { before: 240, after: 200 },
    children: [new TextRun({ text, bold: true, font: FONT, size })]
  });
}

/** CONTENTS page title / section titles: Calibri 14pt bold underlined. */
function contentsHeading(
  text: string,
  opts: { isPageTitle?: boolean } = {}
): Paragraph {
  return new Paragraph({
    spacing: opts.isPageTitle
      ? { before: 240, after: 200 }
      : { after: 160 },
    children: [
      new TextRun({
        text,
        bold: true,
        font: FONT,
        size: CONTENTS_SIZE,
        underline: { type: UnderlineType.SINGLE }
      })
    ]
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
        alignment: AlignmentType.LEFT,
        spacing: { after: i === parts.length - 1 ? 200 : 80 },
        indent: { left: 360, hanging: i === 0 ? 360 : 0 },
        children: [
          new TextRun({
            text: (i === 0 ? "•    " : "") + t.trim(),
            font: FONT,
            size: BODY_SIZE
          })
        ]
      })
  );
}

/** Thin paragraph carrying a horizontal rule (as in the example hdr/ftr). */
function ruleParagraph(): Paragraph {
  return new Paragraph({
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 6, space: 1 }
    },
    children: [new TextRun({ text: "", size: 10 })]
  });
}

function headerLabelCell(text: string, width: number): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    children: [
      new Paragraph({
        children: [new TextRun({ text, bold: true, font: FONT, size: BODY_SIZE })]
      })
    ]
  });
}

function headerValueCell(text: string, width: number): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    children: [
      new Paragraph({
        children: [new TextRun({ text, font: FONT, size: BODY_SIZE })]
      })
    ]
  });
}

/**
 * Page header: logo on the left, then a grid of report details, with a rule
 * underneath - replicating the example document's header table.
 */
function pageHeader(meta: ReportMetadata, itemCount: number): Header {
  const widths = [1540, 1219, 3053, 994, 2854];
  const rows: Array<[string, string, string, string]> = [
    ["Created:", meta.surveyDate, "Contact:", meta.contactName],
    ["Location:", meta.propertyAddress, "Company:", meta.companyName],
    ["Title:", "Damp Survey Report", "Phone:", meta.phone],
    ["No. Items:", String(itemCount), "Email:", meta.email]
  ];
  const tableRows = rows.map(
    (cells, i) =>
      new TableRow({
        children: [
          ...(i === 0
            ? [
                new TableCell({
                  width: { size: widths[0], type: WidthType.DXA },
                  rowSpan: rows.length,
                  verticalAlign: VerticalAlign.TOP,
                  margins: { top: 0, left: 0, bottom: 0, right: 100 },
                  children: [
                    new Paragraph({ children: [assetRun(HEADER_LOGO)] })
                  ]
                })
              ]
            : []),
          headerLabelCell(cells[0], widths[1]),
          headerValueCell(cells[1], widths[2]),
          headerLabelCell(cells[2], widths[3]),
          headerValueCell(cells[3], widths[4])
        ]
      })
  );
  return new Header({
    children: [
      new Table({
        borders: TableBorders.NONE,
        width: { size: 9660, type: WidthType.DXA },
        columnWidths: widths,
        rows: tableRows
      }),
      ruleParagraph()
    ]
  });
}

/**
 * Page footer: rule on top, then logo left and "Doc. Id." / "page N of M"
 * on the right - replicating the example document's footer.
 */
function pageFooter(meta: ReportMetadata): Footer {
  const rightLines: Paragraph[] = [];
  if (meta.docId.trim()) {
    rightLines.push(
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [
          new TextRun({
            text: `Doc. Id.: ${meta.docId.trim()}`,
            font: FONT,
            size: BODY_SIZE
          })
        ]
      })
    );
  }
  rightLines.push(
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [
        new TextRun({
          children: ["page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES],
          font: FONT,
          size: BODY_SIZE
        })
      ]
    })
  );
  return new Footer({
    children: [
      ruleParagraph(),
      new Table({
        borders: TableBorders.NONE,
        width: { size: 9660, type: WidthType.DXA },
        columnWidths: [1926, 4845, 2889],
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: { size: 1926, type: WidthType.DXA },
                margins: { top: 0, left: 0, bottom: 0, right: 100 },
                children: [new Paragraph({ children: [assetRun(FOOTER_LOGO)] })]
              }),
              new TableCell({
                width: { size: 4845, type: WidthType.DXA },
                children: [new Paragraph({ children: [] })]
              }),
              new TableCell({
                width: { size: 2889, type: WidthType.DXA },
                children: rightLines
              })
            ]
          })
        ]
      })
    ]
  });
}

function coverPage(meta: ReportMetadata): Paragraph[] {
  // Content width is 9660 twips = 644px; the example's cover logo fills it.
  const logoWidth = 644;
  const logoHeight = Math.round(
    (COVER_LOGO.height / COVER_LOGO.width) * logoWidth
  );
  return [
    new Paragraph({ spacing: { after: 1200 }, children: [] }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
      children: [assetRun(COVER_LOGO, logoWidth, logoHeight)]
    }),
    new Paragraph({ spacing: { after: 400 }, children: [] }),
    centered("Damp Survey Report", 48),
    new Paragraph({ spacing: { after: 600 }, children: [] }),
    centered(`Property Address: ${meta.propertyAddress}`, 32, true),
    meta.surveyDate ? centered(`Survey date: ${meta.surveyDate}`, 26, false) : null,
    new Paragraph({ spacing: { after: 1200 }, children: [] }),
    centered(meta.website, 28, false),
    pageBreak()
  ].filter((p): p is Paragraph => p !== null);
}

function contentsPage(includeEstimates: boolean): Paragraph[] {
  const out: Paragraph[] = [contentsHeading("CONTENTS", { isPageTitle: true })];
  for (const s of CONTENTS_SECTIONS) {
    if (!includeEstimates && s.title === "Estimates/Costs") continue;
    out.push(contentsHeading(s.title));
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
    out.push(body(label, { bold: true }));
    out.push(body(fillPlaceholders(template, values)));
  }
  out.push(pageBreak());
  return out;
}

/** The nested "Created: <date>" mini-table in an entry's text column. */
function createdTable(created: string): Table {
  return new Table({
    borders: TableBorders.NONE,
    columnWidths: [1534, 2772],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 1534, type: WidthType.DXA },
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: "Created:",
                    bold: true,
                    font: FONT,
                    size: BODY_SIZE
                  })
                ]
              })
            ]
          }),
          new TableCell({
            width: { size: 2772, type: WidthType.DXA },
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: created, font: FONT, size: BODY_SIZE })
                ]
              })
            ]
          })
        ]
      })
    ]
  });
}

/**
 * One photo entry as a borderless three-column table, matching the example:
 * "(N)" | photo | Created-date + descriptive text.
 */
function entryTable(s: SectionState, img: DocImage | undefined): Table {
  const numberCell = new TableCell({
    width: { size: 462, type: WidthType.DXA },
    verticalAlign: VerticalAlign.TOP,
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: `(${s.entry.number})`, font: FONT, size: 18 })
        ]
      })
    ]
  });

  const imageChildren: Paragraph[] = [];
  if (img) {
    const scale = Math.min(
      1,
      ENTRY_IMAGE_MAX_WIDTH / img.width,
      ENTRY_IMAGE_MAX_HEIGHT / img.height
    );
    imageChildren.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new ImageRun({
            data: img.bytes,
            type: img.type,
            transformation: {
              width: Math.round(img.width * scale),
              height: Math.round(img.height * scale)
            }
          })
        ]
      })
    );
  } else {
    imageChildren.push(new Paragraph({ children: [] }));
  }
  const imageCell = new TableCell({
    width: { size: 4892, type: WidthType.DXA },
    margins: { top: 0, left: 0, bottom: 0, right: 200 },
    verticalAlign: VerticalAlign.TOP,
    children: imageChildren
  });

  const textChildren: Array<Paragraph | Table> = [];
  if (s.entry.created) textChildren.push(createdTable(s.entry.created));
  textChildren.push(new Paragraph({ spacing: { after: 80 }, children: [] }));
  if (s.headingLine) textChildren.push(body(s.headingLine, { bold: true }));
  if (s.text.trim().length > 0) textChildren.push(...multiParagraph(s.text));
  if (textChildren.length === 1) textChildren.push(body(""));
  const textCell = new TableCell({
    width: { size: 4306, type: WidthType.DXA },
    verticalAlign: VerticalAlign.TOP,
    children: textChildren
  });

  return new Table({
    borders: TableBorders.NONE,
    width: { size: 9660, type: WidthType.DXA },
    columnWidths: [462, 4892, 4306],
    rows: [
      new TableRow({
        cantSplit: true,
        children: [numberCell, imageCell, textCell]
      })
    ]
  });
}

function photoSections(
  sections: SectionState[],
  images: Map<number, DocImage>
): Array<Paragraph | Table> {
  const out: Array<Paragraph | Table> = [
    heading("INSPECTION DETAILS, OBSERVATIONS & FINDINGS", 32)
  ];
  for (const s of sections) {
    out.push(entryTable(s, images.get(s.entry.number)));
    out.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
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
    out.push(centered(dt.flagLine, BODY_SIZE, true));
  }
  if (extras.dampIssues.other && extras.otherIssueText.trim()) {
    out.push(heading("Other", 30));
    for (const para of extras.otherIssueText.split(/\n+/)) {
      if (para.trim()) out.push(body(para.trim()));
    }
    out.push(centered("Other is an issue in this property", BODY_SIZE, true));
  }
  if (out.length > 0) out.unshift(pageBreak());
  return out;
}

function recommendationsPages(extras: ReportExtras): Paragraph[] {
  const otherText = extras.otherRecommendation
    ? extras.otherRecommendationText.trim()
    : "";
  if (extras.recommendationIds.length === 0 && !otherText) return [];
  const out: Paragraph[] = [pageBreak(), heading("Recommendations", 32)];
  for (const id of extras.recommendationIds) {
    const rec = library.recommendations.find((r) => r.id === id);
    if (rec) out.push(...bulletParagraphs(rec.text));
  }
  if (otherText) out.push(...bulletParagraphs(otherText));
  return out;
}

function parseAmount(s: string): number | null {
  const m = /(\d+(?:[.,]\d+)?)/.exec(s.replace(/[£,\s]/g, ""));
  return m ? Number(m[1]) : null;
}

function costsPages(extras: ReportExtras, meta: ReportMetadata): Paragraph[] {
  if (extras.excludePlanCosts) return [];
  const otherCostText = extras.otherCost ? extras.otherCostDescription.trim() : "";
  if (
    extras.costLines.length === 0 &&
    extras.projectPlanLines.trim() === "" &&
    !otherCostText
  ) {
    return [];
  }
  const out: Paragraph[] = [pageBreak()];
  out.push(
    body(fillPlaceholders(SERVICES_INTRO, { company_name: meta.companyName }))
  );
  out.push(heading(PROJECT_PLAN_HEADING, 26));
  if (extras.projectPlanLines.trim()) {
    for (const line of extras.projectPlanLines.split(/\n+/)) {
      if (line.trim()) out.push(body(line.trim()));
    }
  }

  const billable = [
    ...extras.costLines.map((line) => ({
      description: line.description.trim(),
      amount: line.amount.trim()
    })),
    ...(otherCostText
      ? [{ description: otherCostText, amount: extras.otherCostAmount.trim() }]
      : [])
  ].filter((line) => line.description);

  let total = 0;
  let allNumeric = billable.length > 0;
  for (const line of billable) {
    const amount = line.amount;
    const merged = `${line.description} Cost: £${amount || ""}`;
    out.push(...bulletParagraphs(merged));
    const n = parseAmount(amount);
    if (n === null) allNumeric = false;
    else total += n;
  }
  if (billable.length > 0) {
    out.push(body(allNumeric ? `Total: £${total} + VAT` : "Total: £", { bold: true }));
  }
  out.push(body(COST_FOOTNOTES.vatNote));
  if (extras.surveyDiscount.trim()) {
    out.push(
      body(`• -£${extras.surveyDiscount.trim()} Cost for survey if damp proofing work is completed`)
    );
  }
  if (extras.timeEstimate.trim()) {
    out.push(
      body(`Time to complete the job estimated between ${extras.timeEstimate.trim()}`)
    );
  }
  const cleanup = extras.postProjectCleanup.trim();
  if (cleanup) {
    out.push(body(cleanup, { bold: true }));
  }
  // Finance: plain text line followed by the centred finance graphic.
  out.push(body(COST_FOOTNOTES.financeNote));
  out.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 120, after: 200 },
      children: [assetRun(FINANCE_IMAGE)]
    })
  );
  // Contact note sits above the blue services paragraph (matches example).
  out.push(body(COST_FOOTNOTES.contactNote));
  out.push(body(SERVICES_FULL, { color: SERVICES_BLUE }));
  return out;
}

function limitationsPages(extras: ReportExtras): Paragraph[] {
  const invasive = extras.invasiveSurvey;
  const title = invasive ? INVASIVE_LIMITATIONS_TITLE : LIMITATIONS_TITLE;
  const items = invasive ? INVASIVE_LIMITATIONS : library.limitations;
  const out: Paragraph[] = [pageBreak(), heading(title, 30)];
  for (const l of items) {
    out.push(body(l.heading, { bold: true }));
    out.push(body(l.text));
  }
  return out;
}

export function buildReportDocument(input: ReportInput): Document {
  const { sections, metadata, extras, images } = input;
  const children: Array<Paragraph | Table> = [
    ...coverPage(metadata),
    ...contentsPage(!extras.excludePlanCosts),
    ...introductionPage(metadata),
    ...photoSections(sections, images),
    ...dampTypePages(extras),
    ...recommendationsPages(extras),
    ...costsPages(extras, metadata),
    ...limitationsPages(extras)
  ];

  return new Document({
    styles: {
      default: {
        document: { run: { font: FONT, size: BODY_SIZE } }
      }
    },
    sections: [
      {
        properties: {
          // Matches the example document: A4, its margins, and a title page
          // so the cover shows no header/footer.
          page: {
            size: { width: 11900, height: 16840 },
            margin: {
              top: 840,
              right: 1120,
              bottom: 360,
              left: 1120,
              header: 708,
              footer: 708
            }
          },
          titlePage: true
        },
        headers: { default: pageHeader(metadata, sections.length) },
        footers: { default: pageFooter(metadata) },
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
