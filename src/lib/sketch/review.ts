/**
 * Review-step logic, independent of React: what still needs the user's
 * attention, and how reviewed items become export rows.
 */
import type { DimensionKey, GenerateRow, LengthUnit, LineItem, Measurement, TemplateConfig } from "./types";
import { DIMENSION_KEYS } from "./types";
import { formatNumber, round, toMm } from "./units";

export function emptyMeasurement(unit: LengthUnit): Measurement {
  return {
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
}

/** The user typed or picked a value: it is now authoritative. */
export function manualMeasurement(prev: Measurement, value: number | null): Measurement {
  return {
    ...prev,
    value,
    source: value === null ? "missing" : "manual",
    confidence: value === null ? 0 : 100,
    issues: [],
    alternatives: prev.source === "manual" ? prev.alternatives : prev.alternatives.filter((a) => a !== value),
    needsReview: false,
  };
}

/** The user confirmed a doubtful detected value as correct. */
export function confirmMeasurement(m: Measurement): Measurement {
  return { ...m, needsReview: false, verified: true };
}

let counter = 0;
export function newManualItem(imageIndex: number, unit: LengthUnit, room = ""): LineItem {
  counter++;
  return {
    id: `manual-${Date.now().toString(36)}-${counter}`,
    imageIndex,
    room,
    item: "",
    width: emptyMeasurement(unit),
    height: emptyMeasurement(unit),
    depth: emptyMeasurement(unit),
    remarks: "",
    notes: [],
    question: null,
    region: null,
    confirmed: true,
  };
}

export interface Blocker {
  itemId: string | null;
  field: DimensionKey | "item" | "question" | null;
  message: string;
}

const LABEL: Record<DimensionKey, string> = { width: "Width", height: "Height", depth: "Depth" };

export function findBlockers(items: LineItem[], config: TemplateConfig): Blocker[] {
  const out: Blocker[] = [];
  if (!items.length) out.push({ itemId: null, field: null, message: "There are no rows to export yet." });
  items.forEach((it, i) => {
    const name = it.item || `Row ${i + 1}`;
    if (!it.item.trim()) out.push({ itemId: it.id, field: "item", message: `Row ${i + 1}: enter the item / description.` });
    if (it.question && !it.confirmed) {
      out.push({ itemId: it.id, field: "question", message: `${name}: answer the question and confirm the row.` });
    }
    for (const k of DIMENSION_KEYS) {
      const m = it[k];
      const required = config.requiredFields.includes(k);
      if (required && m.value === null) {
        out.push({ itemId: it.id, field: k, message: `${name}: ${LABEL[k].toLowerCase()} is missing. Please enter it.` });
      } else if (m.needsReview) {
        out.push({
          itemId: it.id,
          field: k,
          message:
            m.value === null
              ? `${name}: confirm that there is no ${LABEL[k].toLowerCase()}, or enter it.`
              : `${name}: verify ${LABEL[k].toLowerCase()} = ${formatNumber(m.value)} ${m.unit}.`,
        });
      }
    }
  });
  return out;
}

export function composeRemarks(it: LineItem, config: TemplateConfig): string {
  if (it.remarks.trim()) return it.remarks.trim();
  if (config.remarksMode === "none") return "";
  if (config.remarksMode === "notes") return it.notes.join("; ");
  const dims = DIMENSION_KEYS.map((k) => it[k]).filter((m) => m.value !== null);
  if (!dims.length) return "";
  const unit = dims[0].unit;
  if (unit === config.inputUnit) return "";
  return `Sketch: ${dims.map((m) => String(round(m.value as number, 3))).join(" × ")} ${unit}`;
}

export function toGenerateRows(items: LineItem[], config: TemplateConfig): GenerateRow[] {
  const mm = (m: Measurement) => (m.value === null ? null : toMm(m.value, m.unit));
  return items.map((it) => ({
    room: it.room,
    item: it.item,
    widthMm: mm(it.width),
    heightMm: mm(it.height),
    depthMm: mm(it.depth),
    remarks: composeRemarks(it, config),
  }));
}
