/**
 * Demo provider (SKETCH_AI_PROVIDER=demo). Returns a fixed example so the
 * interface can be tried without an AI key. Its output is NOT read from the
 * uploaded image; the UI labels it clearly as demo data.
 */
import type { InterpretationProvider, OcrProvider } from "./provider";
import type { Interpretation, OcrPass } from "./schemas";

const box = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });

export class DemoOcrProvider implements OcrProvider {
  readonly name = "demo";
  async transcribe(): Promise<OcrPass> {
    return {
      image_quality: { legible: true, issues: [] },
      tokens: [
        { text: "MBR", kind: "label", alternatives: [], legibility: 98, box: box(80, 40, 220, 90) },
        { text: "2800", kind: "number", alternatives: [], legibility: 97, box: box(220, 820, 360, 870) },
        { text: "2440", kind: "number", alternatives: ["2840"], legibility: 78, box: box(440, 420, 500, 560) },
        { text: "600", kind: "number", alternatives: [], legibility: 96, box: box(520, 300, 580, 360) },
        { text: "Loft", kind: "label", alternatives: [], legibility: 95, box: box(250, 120, 340, 170) },
        { text: "450", kind: "number", alternatives: [], legibility: 92, box: box(440, 130, 500, 200) },
        { text: "1300", kind: "number", alternatives: [], legibility: 96, box: box(620, 760, 740, 810) },
        { text: "400", kind: "number", alternatives: [], legibility: 95, box: box(800, 640, 860, 700) },
      ],
    };
  }
}

const dim = (
  status: Interpretation["items"][number]["width"]["status"],
  value: number | null,
  token_ids: string[],
  confidence: number,
  reason: string,
  expression: string | null = null,
) => ({ status, value, token_ids, confidence, reason, expression });

export class DemoInterpretationProvider implements InterpretationProvider {
  readonly name = "demo";
  async interpret(): Promise<Interpretation> {
    return {
      is_dimensioned_drawing: true,
      summary: "DEMO DATA — a wardrobe with a loft above and a low side unit (not read from your image).",
      drawing_unit: "mm",
      unit_source: "inferred",
      unit_reason: "four-digit furniture dimensions",
      items: [
        {
          room: "MBR",
          item: "Wardrobe Shutter",
          region: box(180, 200, 470, 800),
          width: dim("detected", 2800, ["t2"], 97, "Horizontal dimension under the wardrobe."),
          height: dim("detected", 2440, ["t3"], 90, "Vertical dimension at the right edge of the wardrobe."),
          depth: dim("not_applicable", null, [], 100, "Shutters are priced by area."),
          notes: [],
          question: null,
        },
        {
          room: "MBR",
          item: "Loft",
          region: box(180, 100, 470, 200),
          width: dim("detected", 2800, ["t2"], 93, "Loft spans the full wardrobe width."),
          height: dim("detected", 450, ["t6"], 90, "Height written beside the loft."),
          depth: dim("not_applicable", null, [], 100, "Loft shutters are priced by area."),
          notes: ["Loft width assumed equal to the wardrobe width."],
          question: null,
        },
        {
          room: "MBR",
          item: "Right Expo",
          region: box(470, 200, 520, 800),
          width: dim("detected", 600, ["t4"], 88, "Wardrobe depth written on the side."),
          height: dim("detected", 2440, ["t3"], 85, "Shares the wardrobe height."),
          depth: dim("not_applicable", null, [], 100, ""),
          notes: [],
          question: null,
        },
        {
          room: "MBR",
          item: "Side Unit",
          region: box(600, 600, 880, 780),
          width: dim("detected", 1300, ["t7"], 96, "Horizontal dimension under the side unit."),
          height: dim("missing", null, [], 0, "No height is written for the side unit."),
          depth: dim("detected", 400, ["t8"], 92, "Depth written on the side of the unit."),
          notes: [],
          question: "Is the side unit a box (priced by volume) or only a shutter?",
        },
      ],
      unused_token_ids: [],
      warnings: [],
    };
  }
}
