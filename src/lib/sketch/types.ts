/**
 * Shared data model for the Sketch → Excel pipeline.
 *
 * Everything in here is plain data (JSON-serialisable) so it can travel
 * between the browser and the API routes unchanged.
 */

export type LengthUnit = "mm" | "cm" | "m" | "in" | "ft";

export const LENGTH_UNITS: LengthUnit[] = ["mm", "cm", "m", "in", "ft"];

/** Axis-aligned box in normalised image coordinates (0–1). */
export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A single piece of text read off the drawing by the OCR stage. */
export interface OcrToken {
  id: string;
  text: string;
  kind: "number" | "expression" | "label" | "unit" | "note";
  /** Numeric value when `kind` is number/expression and it can be evaluated. */
  value: number | null;
  /** Other plausible readings of the same handwriting (e.g. "2440" vs "2840"). */
  alternatives: string[];
  /** How legible the text was, 0–100. */
  legibility: number;
  bbox: BBox | null;
}

export type MeasurementSource =
  /** Read directly from a dimension on the drawing. */
  | "detected"
  /** Calculated from numbers on the drawing (e.g. "2440+320"). */
  | "derived"
  /** Typed or corrected by the user. */
  | "manual"
  /** Not present on the drawing. */
  | "missing";

export type DimensionKey = "width" | "height" | "depth";
export const DIMENSION_KEYS: DimensionKey[] = ["width", "height", "depth"];

export interface Measurement {
  /** Value in `unit`, or null when nothing could be identified. */
  value: number | null;
  unit: LengthUnit;
  source: MeasurementSource;
  /** 0–100. Manual values are always 100. */
  confidence: number;
  /** The raw text this came from, e.g. "2760" or "2440+320". */
  rawText: string | null;
  /** Ids of the OCR tokens the value was read from. */
  tokenIds: string[];
  /** Where the value sits on the drawing (normalised). */
  bbox: BBox | null;
  /** Alternative readings the user can pick from. */
  alternatives: number[];
  /** Validation messages; non-empty means the user should look at it. */
  issues: string[];
  /** True until the user has confirmed or corrected a doubtful value. */
  needsReview: boolean;
  /** The user looked at this value and confirmed it. */
  verified?: boolean;
}

/** One row of the output spreadsheet (one component of the furniture). */
export interface LineItem {
  id: string;
  /** Index of the source image in the project (for multi-page projects). */
  imageIndex: number;
  room: string;
  item: string;
  width: Measurement;
  height: Measurement;
  depth: Measurement;
  /** Free text written into the template's remarks column. */
  remarks: string;
  /** Interpretation notes from the AI (assumptions it made). */
  notes: string[];
  /** A question the user must answer before this row is trusted. */
  question: string | null;
  /** Region of the drawing this component covers (normalised). */
  region: BBox | null;
  /** The whole row was confirmed by the user. */
  confirmed: boolean;
}

export interface ImageQualityReport {
  width: number;
  height: number;
  /** Variance-of-Laplacian sharpness score (higher = sharper). */
  sharpness: number | null;
  warnings: string[];
}

export interface AnalysisResult {
  imageIndex: number;
  /** Short description of what the AI thinks the drawing shows. */
  summary: string;
  /** Unit written on / inferred for the drawing. */
  drawingUnit: LengthUnit;
  unitSource: "explicit" | "inferred";
  tokens: OcrToken[];
  items: LineItem[];
  /** Drawing-level warnings: blur, overlapping text, unsupported content… */
  warnings: string[];
  /** Numbers on the drawing that the AI could not attribute to any component. */
  unusedTokenIds: string[];
  provider: string;
  /** True when produced by the demo provider — never real measurements. */
  demo: boolean;
}

/* ------------------------------------------------------------------------- */
/* Excel template configuration                                              */
/* ------------------------------------------------------------------------- */

/** Which template column receives which piece of line-item data. */
export interface ColumnMapping {
  serial?: string;
  room?: string;
  item?: string;
  width?: string;
  height?: string;
  depth?: string;
  remarks?: string;
}

export type MappingField = keyof ColumnMapping;

export interface TemplateConfig {
  id: string;
  name: string;
  /** Worksheet that receives the rows. */
  sheet: string;
  headerRow: number;
  firstDataRow: number;
  /** Last pre-formatted row in the template; rows beyond are cloned from it. */
  lastDataRow: number;
  columns: ColumnMapping;
  /** Unit the template expects in its dimension input columns. */
  inputUnit: LengthUnit;
  /** Decimal places used when converting into `inputUnit`. */
  decimals: number;
  /** Fields that must be present for a row to be complete. */
  requiredFields: DimensionKey[];
  /** Write the room only on the first row of each room group (as in the sample). */
  roomMode: "first-of-group" | "every-row";
  /** Rewrite the serial column 1…n, or keep whatever the template has. */
  serialMode: "renumber" | "keep";
  /** What goes into the remarks column. */
  remarksMode: "source-dimensions" | "notes" | "none";
  /** Clear sample input values in template rows that are not used. */
  clearUnusedRows: boolean;
}

export interface TemplateColumnInfo {
  column: string;
  header: string;
  /** Formula in the first data row (template-relative), if any. */
  formula: string | null;
  numberFormat: string;
  unit: LengthUnit | null;
  role: "input" | "formula" | "static";
}

export interface TemplateProfile {
  config: TemplateConfig;
  sheets: { name: string; dimension: string; rows: number; columns: number }[];
  columns: TemplateColumnInfo[];
  mergedCells: string[];
  /** Sample rows found in the template (used as few-shot examples for the AI). */
  exampleRows: { room: string; item: string; width: number | null; height: number | null; depth: number | null }[];
  /** Human-readable notes from the template inspection. */
  findings: string[];
  fileName: string;
  uploadedAt: string | null;
  builtIn: boolean;
}

/** Row sent to the generator: dimensions already normalised to millimetres. */
export interface GenerateRow {
  room: string;
  item: string;
  widthMm: number | null;
  heightMm: number | null;
  depthMm: number | null;
  remarks: string;
}
