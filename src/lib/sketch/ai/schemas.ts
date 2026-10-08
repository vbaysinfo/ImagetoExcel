/**
 * Structured-output schemas for the two AI passes. The model's response is
 * constrained to these shapes, so the pipeline never has to scrape JSON out
 * of free text.
 */
import { z } from "zod";

/** Box in 0–1000 normalised image coordinates (x0,y0 top-left; x1,y1 bottom-right). */
export const BoxSchema = z.object({
  x0: z.number(),
  y0: z.number(),
  x1: z.number(),
  y1: z.number(),
});

export const OcrPassSchema = z.object({
  image_quality: z.object({
    legible: z.boolean().describe("False when the drawing is too blurry, dark or small to read reliably."),
    issues: z.array(z.string()).describe("Concrete problems: blur, glare, cut-off edges, overlapping text, faint pencil, etc."),
  }),
  tokens: z.array(
    z.object({
      text: z.string().describe("Exactly what is written, character for character (e.g. '2440+320', '650x90', 'Loft', 'mm')."),
      kind: z.enum(["number", "expression", "label", "unit", "note"]),
      alternatives: z
        .array(z.string())
        .describe("Other plausible readings of ambiguous handwriting (e.g. '2840' for '2440'). Empty when unambiguous."),
      legibility: z.number().describe("0–100: how sure you are of the reading."),
      box: BoxSchema.nullable().describe("Where the text is, in 0–1000 coordinates of the image."),
    }),
  ),
});
export type OcrPass = z.infer<typeof OcrPassSchema>;

const DimSchema = z.object({
  status: z
    .enum(["detected", "derived", "missing", "not_applicable"])
    .describe(
      "detected = read from one dimension on the drawing; derived = arithmetic on numbers written on the drawing; missing = should exist but is not on the drawing; not_applicable = this item does not use this dimension.",
    ),
  value: z.number().nullable().describe("In drawing units. Null unless status is detected or derived."),
  token_ids: z.array(z.string()).describe("Ids of the OCR tokens the value comes from. Required for detected/derived."),
  expression: z.string().nullable().describe("For derived values: the arithmetic using the written numbers, e.g. '2440+320'."),
  confidence: z.number().describe("0–100: confidence that this value is right for this dimension of this item."),
  reason: z.string().describe("One short sentence: which dimension line / position on the drawing this came from, or why it is missing."),
});

export const InterpretationSchema = z.object({
  is_dimensioned_drawing: z.boolean().describe("False when the image is not a drawing with measurements."),
  summary: z.string().describe("One or two sentences describing what the drawing shows."),
  drawing_unit: z.enum(["mm", "cm", "m", "in", "ft"]),
  unit_source: z.enum(["explicit", "inferred"]),
  unit_reason: z.string(),
  items: z.array(
    z.object({
      room: z.string().describe("Room / area label, e.g. 'MBR', 'GBR', 'Kitchen', '2nd Floor Bedroom'. Empty string if unknown."),
      item: z.string().describe("Component name in the style of the template's examples."),
      region: BoxSchema.nullable().describe("Area of the drawing this component occupies, 0–1000 coordinates."),
      width: DimSchema,
      height: DimSchema,
      depth: DimSchema,
      notes: z.array(z.string()).describe("Assumptions made for this row."),
      question: z
        .string()
        .nullable()
        .describe("A specific question for the user if something about this row is ambiguous; otherwise null."),
    }),
  ),
  unused_token_ids: z.array(z.string()).describe("Number tokens that were not used for any item."),
  warnings: z.array(z.string()).describe("Drawing-level problems the user should know about."),
});
export type Interpretation = z.infer<typeof InterpretationSchema>;
