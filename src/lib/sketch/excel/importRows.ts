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
    // A "⚠ CHECK: …" note marks values still to be filled or confirmed.
    // Turn it back into review flags (the note is recomputed on export).
    const check = /⚠?\s*CHECK:?\s*(.*)$/iu.exec(remarks);
    let question: string | null = null;
    if (check) {
      remarks = remarks.slice(0, check.index).trim();
      const note = check[1].trim();
      const lower = note.toLowerCase();
      for (const [key, m] of [["width", width], ["height", height], ["depth", depth]] as const) {
        const required = config.requiredFields.includes(key);
        if (lower.includes(key) || (required && m.value === null)) {
          m.needsReview = true;
          m.source = m.value === null ? "missing" : "detected";
          m.confidence = m.value === null ? 0 : 70;
          m.issues = [m.value === null ? "Not written on the sketch — please enter it." : "Marked to check — confirm or correct it."];
        }
      }
      if (note) question = `To check: ${note}`;
    }
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
      question,
      region: null,
      confirmed: question === null,
    });
  }
  return items;
}
