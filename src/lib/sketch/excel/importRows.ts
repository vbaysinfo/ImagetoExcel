/**
 * Read the rows of a previously generated (or hand-filled) workbook back into
 * editable line items, using the active template's mapping.
 */
import { XlsxWorkbook } from "./xlsx";
import type { LineItem, Measurement, TemplateProfile } from "../types";

function measurement(value: unknown, profile: TemplateProfile): Measurement {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  const ok = Number.isFinite(n) && n > 0;
  return {
    value: ok ? n : null,
    unit: profile.config.inputUnit,
    source: ok ? "manual" : "missing",
    confidence: ok ? 100 : 0,
    rawText: null,
    tokenIds: [],
    bbox: null,
    alternatives: [],
    issues: [],
    needsReview: false,
  };
}

const text = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

export async function importRows(data: Buffer, profile: TemplateProfile): Promise<LineItem[]> {
  const { config } = profile;
  const book = await XlsxWorkbook.load(data);
  if (!book.sheetNames.includes(config.sheet)) {
    throw new Error(
      `This workbook has no sheet named "${config.sheet}", so it does not match the active template (sheets found: ${book.sheetNames.join(", ")}).`,
    );
  }
  const sheet = await book.sheet(config.sheet);
  const rows = sheet.rowNumbers.filter((r) => r >= config.firstDataRow);
  const cols = config.columns;
  const read = (col: string | undefined, row: number) => (col ? sheet.readCell(`${col}${row}`).value : null);

  const items: LineItem[] = [];
  let room = "";
  for (const r of rows) {
    const item = text(read(cols.item, r));
    const width = measurement(read(cols.width, r), profile);
    const height = measurement(read(cols.height, r), profile);
    const depth = measurement(read(cols.depth, r), profile);
    if (!item && width.value === null && height.value === null && depth.value === null) continue;
    const rowRoom = text(read(cols.room, r));
    // Rooms written only on the first row of a group apply to the rows below.
    if (rowRoom) room = rowRoom;
    let remarks = text(read(cols.remarks, r));
    // Drop the automatic "CHECK:" note from draft exports; it is recomputed.
    remarks = remarks.replace(/\s*⚠\s*CHECK:.*$/u, "").trim();
    items.push({
      id: `manual-import-${r}-${Math.random().toString(36).slice(2, 7)}`,
      imageIndex: 0,
      room,
      item,
      width,
      height,
      depth,
      remarks,
      notes: [],
      question: null,
      region: null,
      confirmed: true,
    });
  }
  return items;
}
