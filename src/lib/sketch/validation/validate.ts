/**
 * Validation: turns the raw AI output into reviewed-ready line items and
 * decides, per value, whether it can be used automatically, must be verified
 * or must be entered by the user.
 *
 * The key safeguard: a value is only trusted when it can be traced back to
 * text the OCR stage actually read on the drawing. Anything the model cannot
 * cite is downgraded to "needs review" — the app never silently uses a
 * number that is not on the sketch.
 */
import { MEDIUM_CONFIDENCE, clampConfidence } from "../confidence";
import type { Interpretation, OcrPass } from "../ai/schemas";
import type {
  AnalysisResult,
  BBox,
  DimensionKey,
  LengthUnit,
  LineItem,
  Measurement,
  OcrToken,
  TemplateConfig,
} from "../types";
import { toMm } from "../units";

const MISSING_MESSAGE = "Unable to confidently identify this measurement. Please confirm.";

type Box = { x0: number; y0: number; x1: number; y1: number } | null;

export function toBBox(box: Box): BBox | null {
  if (!box) return null;
  const vals = [box.x0, box.y0, box.x1, box.y1];
  if (vals.some((v) => !Number.isFinite(v))) return null;
  const x0 = Math.max(0, Math.min(box.x0, box.x1)) / 1000;
  const y0 = Math.max(0, Math.min(box.y0, box.y1)) / 1000;
  const x1 = Math.min(1000, Math.max(box.x0, box.x1)) / 1000;
  const y1 = Math.min(1000, Math.max(box.y0, box.y1)) / 1000;
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function unionBox(boxes: (BBox | null)[]): BBox | null {
  const b = boxes.filter((x): x is BBox => Boolean(x));
  if (!b.length) return null;
  const x0 = Math.min(...b.map((v) => v.x));
  const y0 = Math.min(...b.map((v) => v.y));
  const x1 = Math.max(...b.map((v) => v.x + v.w));
  const y1 = Math.max(...b.map((v) => v.y + v.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** All numbers written in a piece of text ("2440+320" → [2440, 320]). */
export function numbersIn(text: string): number[] {
  return (text.replace(/(\d),(\d{3})/g, "$1$2").match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
}

/**
 * Safely evaluate simple arithmetic written on a drawing ("2440+320",
 * "2*600", "(1200-50)/2"). Returns null for anything else.
 */
export function evalArithmetic(expr: string): number | null {
  const s = expr.replace(/\s+/g, "").replace(/[×]/g, "*");
  if (!/^[\d.+\-*/()]+$/.test(s)) return null;
  let pos = 0;
  const parseExpr = (): number => {
    let v = parseTerm();
    while (s[pos] === "+" || s[pos] === "-") {
      const op = s[pos++];
      const r = parseTerm();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  };
  const parseTerm = (): number => {
    let v = parseFactor();
    while (s[pos] === "*" || s[pos] === "/") {
      const op = s[pos++];
      const r = parseFactor();
      v = op === "*" ? v * r : v / r;
    }
    return v;
  };
  const parseFactor = (): number => {
    if (s[pos] === "(") {
      pos++;
      const v = parseExpr();
      if (s[pos++] !== ")") throw new Error("paren");
      return v;
    }
    if (s[pos] === "-") {
      pos++;
      return -parseFactor();
    }
    const m = /^\d+(?:\.\d+)?/.exec(s.slice(pos));
    if (!m) throw new Error("num");
    pos += m[0].length;
    return Number(m[0]);
  };
  try {
    const v = parseExpr();
    return pos === s.length && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

export function buildTokens(ocr: OcrPass): OcrToken[] {
  return ocr.tokens.map((t, i) => {
    let value: number | null = null;
    if (t.kind === "number") value = numbersIn(t.text)[0] ?? null;
    else if (t.kind === "expression") value = evalArithmetic(t.text);
    return {
      id: `t${i + 1}`,
      text: t.text,
      kind: t.kind,
      value,
      alternatives: t.alternatives.filter((a) => a && a !== t.text),
      legibility: clampConfidence(t.legibility),
      bbox: toBBox(t.box),
    };
  });
}

const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e-6, Math.abs(b) * 1e-6);

type Dim = Interpretation["items"][number]["width"];

function validateDimension(
  dim: Dim,
  key: DimensionKey,
  tokens: Map<string, OcrToken>,
  unit: LengthUnit,
  required: boolean,
): Measurement {
  const base: Measurement = {
    value: null,
    unit,
    source: "missing",
    confidence: 0,
    rawText: null,
    tokenIds: [],
    bbox: null,
    alternatives: [],
    issues: [],
    needsReview: false,
  };

  if (dim.status === "not_applicable" || dim.status === "missing" || dim.value === null) {
    if (dim.status === "not_applicable" && !required) return { ...base, confidence: 100 };
    const reason = dim.reason ? ` (${dim.reason})` : "";
    return {
      ...base,
      issues: [
        required && dim.status === "not_applicable"
          ? `The template needs a ${key} for every row, but none applies on the drawing${reason}. Please enter it.`
          : `${MISSING_MESSAGE}${reason}`,
      ],
      needsReview: required || dim.status === "missing",
    };
  }

  const cited = dim.token_ids.map((id) => tokens.get(id)).filter((t): t is OcrToken => Boolean(t));
  let confidence = clampConfidence(dim.confidence);
  const issues: string[] = [];
  const alternatives = new Set<number>();
  const value = dim.value;

  if (!cited.length) {
    confidence = Math.min(confidence, 40);
    issues.push("The AI could not point to where this value is written on the drawing. Please check it.");
  } else {
    const legibility = Math.min(...cited.map((t) => t.legibility));
    confidence = Math.min(confidence, legibility);
    const written = cited.flatMap((t) => numbersIn(t.text));
    const alt = cited.flatMap((t) => t.alternatives.flatMap(numbersIn));

    if (dim.status === "detected") {
      if (written.some((n) => near(n, value))) {
        for (const a of alt) if (!near(a, value)) alternatives.add(a);
      } else if (alt.some((n) => near(n, value))) {
        confidence = Math.min(confidence, 70);
        issues.push(`The handwriting was read as "${cited.map((t) => t.text).join(", ")}"; this value uses an alternative reading.`);
        for (const n of written) alternatives.add(n);
      } else {
        confidence = Math.min(confidence, 40);
        issues.push(`This value does not match the text read from the drawing ("${cited.map((t) => t.text).join(", ")}").`);
        for (const n of written) alternatives.add(n);
      }
    } else {
      // Derived: the arithmetic must check out and only use written numbers.
      const expr = dim.expression ?? "";
      const result = evalArithmetic(expr);
      const used = numbersIn(expr);
      const pool = [...written, ...alt];
      if (result === null || !near(result, value)) {
        confidence = Math.min(confidence, 50);
        issues.push(`The calculation "${expr || "?"}" does not give ${value}. Please check.`);
      } else if (!used.every((n) => pool.some((w) => near(w, n)))) {
        confidence = Math.min(confidence, 50);
        issues.push(`The calculation "${expr}" uses numbers that are not written on the drawing.`);
      } else {
        // A correct calculation from written numbers is still worth a glance.
        confidence = Math.min(confidence, 94);
      }
    }
    if (alternatives.size) {
      confidence = Math.min(confidence, MEDIUM_CONFIDENCE - 1);
      issues.push(`The handwriting is ambiguous — it could also be ${[...alternatives].join(" or ")}.`);
    }
  }

  // Plausibility for furniture/interior work.
  const mm = toMm(value, unit);
  if (mm <= 0) {
    confidence = Math.min(confidence, 30);
    issues.push("A dimension must be greater than zero.");
  } else if (mm < 15 || mm > 15000) {
    confidence = Math.min(confidence, 70);
    issues.push(`${value} ${unit} is unusually ${mm < 15 ? "small" : "large"} for this kind of work — check the unit and the reading.`);
  }

  return {
    ...base,
    value,
    source: dim.status === "derived" ? "derived" : "detected",
    confidence,
    rawText: dim.status === "derived" ? dim.expression : cited.map((t) => t.text).join(", ") || null,
    tokenIds: cited.map((t) => t.id),
    bbox: unionBox(cited.map((t) => t.bbox)),
    alternatives: [...alternatives],
    issues: dim.reason && issues.length ? [...issues, `AI note: ${dim.reason}`] : issues,
    needsReview: confidence < MEDIUM_CONFIDENCE,
  };
}

export function buildAnalysis(opts: {
  imageIndex: number;
  ocr: OcrPass;
  tokens: OcrToken[];
  interpretation: Interpretation;
  config: TemplateConfig;
  provider: string;
  demo?: boolean;
  qualityWarnings?: string[];
}): AnalysisResult {
  const { ocr, tokens, interpretation: ai, config } = opts;
  const tokenMap = new Map(tokens.map((t) => [t.id, t]));
  const unit = ai.drawing_unit;
  const warnings: string[] = [...(opts.qualityWarnings ?? [])];

  if (!ocr.image_quality.legible) {
    warnings.push("The image is hard to read. Results may be incomplete — consider retaking the photo in good light, straight on.");
  }
  warnings.push(...ocr.image_quality.issues.map((i) => `Image: ${i}`));
  if (!ai.is_dimensioned_drawing) {
    warnings.push("This does not look like a drawing with measurements. You can still add rows manually.");
  }
  if (ai.unit_source === "inferred") {
    warnings.push(`No unit is written on the drawing; the values were read as ${unit} (${ai.unit_reason}). Change the unit if this is wrong.`);
  }
  warnings.push(...ai.warnings);

  const items: LineItem[] = ai.items.map((it, i) => {
    const dims = Object.fromEntries(
      (["width", "height", "depth"] as DimensionKey[]).map((k) => [
        k,
        validateDimension(it[k], k, tokenMap, unit, config.requiredFields.includes(k)),
      ]),
    ) as Record<DimensionKey, Measurement>;
    return {
      id: `img${opts.imageIndex}-item${i + 1}`,
      imageIndex: opts.imageIndex,
      room: it.room.trim(),
      item: it.item.trim(),
      ...dims,
      remarks: "",
      notes: it.notes,
      question: it.question?.trim() || null,
      region: toBBox(it.region),
      confirmed: false,
    };
  });

  if (ai.is_dimensioned_drawing && items.length === 0) {
    warnings.push("I detected the drawing but could not identify any components. Please add the rows manually.");
  }

  const unused = ai.unused_token_ids.filter((id) => {
    const t = tokenMap.get(id);
    return t && (t.kind === "number" || t.kind === "expression");
  });
  if (unused.length) {
    warnings.push(
      `${unused.length} number(s) on the drawing were not used: ${unused.map((id) => `"${tokenMap.get(id)?.text}"`).join(", ")}. Check whether a row is missing.`,
    );
  }

  return {
    imageIndex: opts.imageIndex,
    summary: ai.summary,
    drawingUnit: unit,
    unitSource: ai.unit_source,
    tokens,
    items,
    warnings,
    unusedTokenIds: unused,
    provider: opts.provider,
    demo: Boolean(opts.demo),
  };
}
