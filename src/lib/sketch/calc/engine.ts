/**
 * Calculation engine: turns reviewed line items into the exact cell values the
 * template expects, then evaluates the template's own formulas for preview.
 *
 * Shared by the browser (live preview) and the server (Excel generation) so
 * both always agree.
 */
import type { CellValue } from "./formula";
import { evaluateFormula } from "./formula";
import { shiftFormula } from "./cellref";
import type { GenerateRow, TemplateConfig, TemplateProfile } from "../types";
import { fromMm, round } from "../units";

export interface RowCells {
  /** Absolute row number in the sheet. */
  row: number;
  /** Values for the mapped input columns, keyed by column letter. */
  inputs: Record<string, CellValue>;
}

/** Convert a millimetre value into the template's unit with its precision. */
export function toTemplateUnit(mm: number | null, config: TemplateConfig): number | null {
  if (mm === null || !Number.isFinite(mm)) return null;
  return round(fromMm(mm, config.inputUnit), config.decimals);
}

/** Lay out the rows exactly as they will be written to the sheet. */
export function layoutRows(rows: GenerateRow[], config: TemplateConfig): RowCells[] {
  const { columns } = config;
  let lastRoom: string | null = null;
  return rows.map((r, i) => {
    const row = config.firstDataRow + i;
    const inputs: Record<string, CellValue> = {};
    if (columns.serial && config.serialMode === "renumber") inputs[columns.serial] = i + 1;
    if (columns.room) {
      const room = r.room.trim();
      const sameAsPrevious = lastRoom !== null && room.toLowerCase() === lastRoom.toLowerCase();
      inputs[columns.room] = config.roomMode === "first-of-group" && sameAsPrevious ? null : room || null;
      lastRoom = room;
    }
    if (columns.item) inputs[columns.item] = r.item.trim() || null;
    if (columns.width) inputs[columns.width] = toTemplateUnit(r.widthMm, config);
    if (columns.height) inputs[columns.height] = toTemplateUnit(r.heightMm, config);
    if (columns.depth) inputs[columns.depth] = toTemplateUnit(r.depthMm, config);
    if (columns.remarks) inputs[columns.remarks] = r.remarks.trim() || null;
    return { row, inputs };
  });
}

export interface ComputedCell {
  column: string;
  header: string;
  value: CellValue;
  error: string | null;
}

/**
 * Evaluate every formula column of the template for one laid-out row, using
 * the template's first-data-row formulas shifted to this row.
 */
export function computeRow(cells: RowCells, profile: TemplateProfile): ComputedCell[] {
  const formulaCols = profile.columns.filter((c) => c.formula);
  const values = new Map<string, CellValue>(Object.entries(cells.inputs));
  const visiting = new Set<string>();
  const dRow = cells.row - profile.config.firstDataRow;

  const getCell = (col: string, row: number): CellValue => {
    if (row !== cells.row) return null; // Row-local preview.
    if (values.has(col)) return values.get(col) ?? null;
    const info = formulaCols.find((c) => c.column === col);
    if (!info?.formula) return null;
    if (visiting.has(col)) throw new Error("#CIRCULAR");
    visiting.add(col);
    const res = evaluateFormula(shiftFormula(info.formula, dRow, 0), { getCell });
    visiting.delete(col);
    const v = res.ok ? res.value : null;
    values.set(col, v);
    return v;
  };

  return formulaCols.map((c) => {
    const res = evaluateFormula(shiftFormula(c.formula as string, dRow, 0), { getCell });
    return {
      column: c.column,
      header: c.header,
      value: res.ok ? res.value : null,
      error: res.ok ? null : res.error,
    };
  });
}
