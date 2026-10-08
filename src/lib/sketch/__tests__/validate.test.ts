import { describe, expect, it } from "vitest";
import { buildAnalysis, buildTokens, evalArithmetic, numbersIn } from "../validation/validate";
import type { Interpretation, OcrPass } from "../ai/schemas";
import type { TemplateConfig } from "../types";

const config = { requiredFields: ["width", "height"] } as unknown as TemplateConfig;

const ocr: OcrPass = {
  image_quality: { legible: true, issues: [] },
  tokens: [
    { text: "2800", kind: "number", alternatives: [], legibility: 98, box: { x0: 0, y0: 0, x1: 100, y1: 50 } },
    { text: "2440+320", kind: "expression", alternatives: [], legibility: 96, box: null },
    { text: "1300", kind: "number", alternatives: ["1500"], legibility: 90, box: null },
    { text: "650x90", kind: "expression", alternatives: [], legibility: 95, box: null },
  ],
};

const dim = (status: string, value: number | null, ids: string[], confidence = 97, expression: string | null = null) => ({
  status: status as "detected",
  value,
  token_ids: ids,
  expression,
  confidence,
  reason: "",
});

function run(items: Interpretation["items"]) {
  const tokens = buildTokens(ocr);
  return buildAnalysis({
    imageIndex: 1,
    ocr,
    tokens,
    config,
    provider: "test",
    interpretation: {
      is_dimensioned_drawing: true,
      summary: "",
      drawing_unit: "mm",
      unit_source: "explicit",
      unit_reason: "",
      items,
      unused_token_ids: [],
      warnings: [],
    },
  });
}

const item = (width: ReturnType<typeof dim>, height: ReturnType<typeof dim>) => ({
  room: "MBR",
  item: "Wardrobe",
  region: null,
  width,
  height,
  depth: dim("not_applicable", null, []),
  notes: [],
  question: null,
});

describe("validation", () => {
  it("parses numbers and arithmetic safely", () => {
    expect(numbersIn("2440+320")).toEqual([2440, 320]);
    expect(numbersIn("1,300 mm")).toEqual([1300]);
    expect(evalArithmetic("2440+320")).toBe(2760);
    expect(evalArithmetic("650x90")).toBeNull();
    expect(evalArithmetic("alert(1)")).toBeNull();
  });

  it("trusts values traced to legible text", () => {
    const [it0] = run([item(dim("detected", 2800, ["t1"]), dim("derived", 2760, ["t2"], 97, "2440+320"))]).items;
    expect(it0.width).toMatchObject({ value: 2800, confidence: 97, needsReview: false, issues: [] });
    expect(it0.width.bbox).not.toBeNull();
    // Correct arithmetic on written numbers: usable but capped at medium.
    expect(it0.height).toMatchObject({ value: 2760, source: "derived", confidence: 94, needsReview: false });
  });

  it("never silently trusts values that are not on the drawing", () => {
    const [it0] = run([item(dim("detected", 2900, ["t1"]), dim("detected", 2440, []))]).items;
    expect(it0.width.needsReview).toBe(true);
    expect(it0.width.alternatives).toContain(2800);
    expect(it0.height.needsReview).toBe(true);
    expect(it0.height.confidence).toBeLessThanOrEqual(40);
  });

  it("rejects derived values whose arithmetic is wrong", () => {
    const [it0] = run([item(dim("detected", 2800, ["t1"]), dim("derived", 2800, ["t2"], 97, "2440+320"))]).items;
    expect(it0.height.needsReview).toBe(true);
  });

  it("flags ambiguous handwriting and missing required values", () => {
    const [it0] = run([item(dim("detected", 1300, ["t3"]), dim("missing", null, []))]).items;
    expect(it0.width.needsReview).toBe(true);
    expect(it0.width.alternatives).toEqual([1500]);
    expect(it0.height).toMatchObject({ value: null, needsReview: true });
    expect(it0.height.issues[0]).toMatch(/Unable to confidently identify/);
    // Optional depth that does not apply is fine.
    expect(it0.depth.needsReview).toBe(false);
  });
});
