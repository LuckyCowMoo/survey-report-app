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
  /**
   * Editable vector annotations for the primary photo (image 0), in normalized
   * image coordinates. Persisted in .dmsr; composited into images for Word.
   */
  annotations?: PhotoAnnotation[];
  /**
   * Non-destructive crop of the primary photo. Original bytes stay intact;
   * Word/preview apply this rectangle.
   */
  photoCrop?: PhotoCrop;
}

/** Normalized point in image space (0..1 on each axis). */
export type NormPoint = { x: number; y: number };

/** Visible rectangle of a photo, in normalized 0–1 image coordinates. */
export type PhotoCrop = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

/** Red-pen markup stored with a field-note / project photo. */
export type PhotoAnnotation =
  | {
      id: string;
      kind: "freehand";
      points: NormPoint[];
    }
  | {
      id: string;
      kind: "line";
      a: NormPoint;
      b: NormPoint;
    }
  | {
      id: string;
      kind: "circle";
      center: NormPoint;
      /** Radius as a fraction of image width. */
      radius: number;
    }
  | {
      id: string;
      kind: "arrow";
      tail: NormPoint;
      tip: NormPoint;
    }
  | {
      id: string;
      /** Abstract edge-following polyline with sharp corners. */
      kind: "polyline";
      points: NormPoint[];
    }
  | {
      id: string;
      /** Short note callout: leader to an anchor point + text box. */
      kind: "callout";
      /** Point on the photo the note refers to. */
      anchor: NormPoint;
      /** Top-left of the text box. */
      label: NormPoint;
      text: string;
    };

/** One in-app field-notes capture (pre-matcher). */
export interface FieldNoteShot {
  id: string;
  /** 1-based entry number; renumbered on reorder/delete. */
  number: number;
  note: string;
  /** Report-and-Run style date string, e.g. "Thu, 8/6/2026". */
  created: string;
  imageName: string;
  image: Uint8Array;
  /** Editable vector annotations; raw `image` stays unburned. */
  annotations?: PhotoAnnotation[];
  /** Non-destructive crop; raw `image` stays uncropped. */
  photoCrop?: PhotoCrop;
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
  /**
   * Soft library match: wording looks complete but confidence is low.
   * Yellow/green striped pip until the section has been focused for ~5s.
   */
  pendingReview: boolean;
  /**
   * Long unrecognised field note kept as the surveyor's prose.
   * Yellow/blue striped pip until focused ~5s (confirms no cleanup needed → blue manual),
   * or until Ask AI rewrites it (→ purple).
   */
  pendingNoteConfirm: boolean;
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
  /** Surveyor name shown as "Contact:" in the page header (from Settings). */
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
  /** Optional areas/rooms where this work applies. */
  location?: string;
}

export interface ReportExtras {
  /** Which damp-type explainers to include and flag. */
  dampIssues: {
    risingDamp: boolean;
    penetratingDamp: boolean;
    condensation: boolean;
    other: boolean;
  };
  /** Free-text explainer when dampIssues.other is ticked. */
  otherIssueText: string;
  /** Ids of recommendation paragraphs to include. */
  recommendationIds: string[];
  /** Extra free-text recommendation when ticked. */
  otherRecommendation: boolean;
  otherRecommendationText: string;
  /** Free-text lines describing the rooms/areas in the project plan. */
  projectPlanLines: string;
  costLines: CostLine[];
  /** Extra free-text cost line when ticked. */
  otherCost: boolean;
  otherCostDescription: string;
  otherCostAmount: string;
  surveyDiscount: string;
  timeEstimate: string;
  /**
   * When true, omit the project plan, costs, finance graphic and related
   * service paragraphs from the exported report (recommendations-only).
   */
  excludePlanCosts: boolean;
  /**
   * When true, the generated report uses invasive-survey limitations wording
   * instead of the default non-invasive limitations section.
   */
  invasiveSurvey: boolean;
  /**
   * Which ticks were last set by details AI (shown purple in the UI),
   * plus short reasons shown under each AI pick.
   * Manual toggles clear the matching marks/reasons.
   */
  aiSuggested: {
    issues: {
      risingDamp: boolean;
      penetratingDamp: boolean;
      condensation: boolean;
    };
    issueReasons: {
      risingDamp?: string;
      penetratingDamp?: string;
      condensation?: string;
    };
    recommendationIds: string[];
    recommendationReasons: Record<string, string>;
    costItemIds: string[];
    costReasons: Record<string, string>;
  };
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
