/** A photo entry parsed out of the shorthand document. */
export interface ShorthandEntry {
  /** The entry number as written in the shorthand doc, e.g. 3 for "(3)". */
  number: number;
  /** Raw note text the surveyor typed under the photo ("" when absent). */
  note: string;
  /** The "Created" date line, verbatim, if present. */
  created: string;
  /** Media file names inside the docx (word/media/...), in order. */
  imageNames: string[];
  /** Raw bytes of each image, matching imageNames. */
  images: Uint8Array[];
}

/** How a section's final text was decided. */
export type TextSource = "library" | "ai" | "manual" | "crossref" | "empty";

/** Working state for one report section (one photo entry). */
export interface SectionState {
  entry: ShorthandEntry;
  /** Id of the chosen library paragraph, when source is "library". */
  libraryId: string | null;
  /** Values filled into the paragraph's placeholders. */
  placeholderValues: Record<string, string>;
  /** Optional short heading line above the text, e.g. "Reading 1". */
  headingLine: string;
  /** When source is "crossref": the section number being referenced. */
  crossrefSection: number | null;
  /** The current text that will appear in the report. */
  text: string;
  source: TextSource;
  /** True when the matcher wants the AI (or the user) to look at this. */
  needsAttention: boolean;
  /** Candidate library ids suggested by the matcher, best first. */
  suggestions: string[];
}

export interface ReportMetadata {
  companyName: string;
  website: string;
  propertyAddress: string;
  clientName: string;
  propertyType: string;
  surveyDate: string;
  weatherDesc: string;
  temperature: string;
  skyDesc: string;
  /** Property / client contact shown as "Contact:" in the page header. */
  contactName: string;
  /** Property / client phone shown in the page header. */
  phone: string;
  /** Property / client email shown in the page header. */
  email: string;
  /** Document id shown in the footer, e.g. "112.1". */
  docId: string;
}

export interface CostLine {
  id: string;
  /** Library cost item id, or "custom". */
  itemId: string;
  /** Short label shown in the UI (matches the dropdown option). */
  label: string;
  description: string;
  amount: string;
}

export interface ReportExtras {
  /** Which damp-type explainers to include and flag. */
  dampIssues: { risingDamp: boolean; penetratingDamp: boolean; condensation: boolean };
  /** Ids of recommendation paragraphs to include. */
  recommendationIds: string[];
  /** Free-text lines describing the rooms/areas in the project plan. */
  projectPlanLines: string;
  costLines: CostLine[];
  surveyDiscount: string;
  timeEstimate: string;
}

export interface LibraryPlaceholder {
  key: string;
  label: string;
  default: string;
}

export interface LibraryParagraph {
  id: string;
  group: string;
  topic: string;
  keywords: string[];
  placeholders: LibraryPlaceholder[];
  text: string;
}

export interface LibraryRecommendation {
  id: string;
  label: string;
  keywords: string[];
  text: string;
}

export interface LibraryCostItem {
  id: string;
  label: string;
  text: string;
}

export interface LibraryDampType {
  id: string;
  title: string;
  flagLine: string;
  paragraphs: string[];
}

export interface LibraryLimitation {
  heading: string;
  text: string;
}

export interface ContentLibrary {
  photoParagraphs: LibraryParagraph[];
  dampTypes: LibraryDampType[];
  recommendations: LibraryRecommendation[];
  costItems: LibraryCostItem[];
  limitations: LibraryLimitation[];
}
