import type { LengthUnit } from "./types";

/** Millimetres per unit. 1 in = 25.4 mm exactly, 1 ft = 304.8 mm exactly. */
const MM_PER: Record<LengthUnit, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
  ft: 304.8,
};

export const UNIT_LABELS: Record<LengthUnit, string> = {
  mm: "mm",
  cm: "cm",
  m: "m",
  in: "inch",
  ft: "ft",
};

export function toMm(value: number, unit: LengthUnit): number {
  return value * MM_PER[unit];
}

export function fromMm(mm: number, unit: LengthUnit): number {
  return mm / MM_PER[unit];
}

export function convert(value: number, from: LengthUnit, to: LengthUnit): number {
  return fromMm(toMm(value, from), to);
}

export function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * f) / f;
}

/** Parse a unit written on a drawing or in a header ("MM", "inch", "Ft.", '"', "'"). */
export function parseUnit(text: string | null | undefined): LengthUnit | null {
  if (!text) return null;
  const t = text.trim().toLowerCase().replace(/[.\s]/g, "");
  if (["mm", "millimeter", "millimetre", "millimeters", "millimetres"].includes(t)) return "mm";
  if (["cm", "centimeter", "centimetre", "centimeters", "centimetres"].includes(t)) return "cm";
  if (["m", "meter", "metre", "meters", "metres", "mtr", "mtrs"].includes(t)) return "m";
  if (["in", "inch", "inches", '"', "''", "″"].includes(t)) return "in";
  if (["ft", "feet", "foot", "'", "′"].includes(t)) return "ft";
  return null;
}

/** Find a unit inside a header such as "Width\n(ft)" or "Depth (mm) auto". */
export function unitFromHeader(header: string): LengthUnit | null {
  const m = header.match(/\(([^)]*)\)/g);
  if (!m) return null;
  for (const group of m) {
    const u = parseUnit(group.slice(1, -1));
    if (u) return u;
  }
  return null;
}

export function formatNumber(value: number | null | undefined, maxDecimals = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  return round(value, maxDecimals).toLocaleString("en-IN", { maximumFractionDigits: maxDecimals });
}
