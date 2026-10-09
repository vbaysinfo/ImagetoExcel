/**
 * Excel generation: populate a copy of the template with reviewed rows.
 *
 * The template buffer is never modified — it is loaded into a fresh in-memory
 * zip for every request. Inputs go into the mapped columns of the template's
 * pre-formatted rows; formula columns keep their formulas, get correct cached
 * results (so phone previews show numbers before Excel recalculates) and the
 * workbook is flagged for full recalculation on open.
 */
import { XlsxWorkbook } from "./xlsx";
import { layoutRows } from "../calc/engine";
import { evaluateFormula, type CellValue } from "../calc/formula";
import { splitRef } from "../calc/cellref";
import type { GenerateRow, TemplateProfile } from "../types";

export interface GenerateResult {
  buffer: Buffer;
  rowsWritten: number;
  rowsAdded: number;
  uncomputedFormulas: number;
}

export async function generateWorkbook(
  template: ArrayBuffer | Uint8Array | Buffer,
  profile: TemplateProfile,
  rows: GenerateRow[],
): Promise<GenerateResult> {
  const { config } = profile;
  const book = await XlsxWorkbook.load(template);
  const sheet = await book.sheet(config.sheet);

  const laidOut = layoutRows(rows, config);
  const inputColumns = Object.values(config.columns).filter((c): c is string => Boolean(c));
  const lastUsedRow = config.firstDataRow + laidOut.length - 1;

  // 1. Make sure every needed row exists (clone the last template row's styling).
  let rowsAdded = 0;
  for (let r = config.lastDataRow + 1; r <= lastUsedRow; r++) {
    sheet.ensureRow(r, config.lastDataRow);
    rowsAdded++;
  }

  // 2. Write inputs.
  for (const { row, inputs } of laidOut) {
    for (const col of inputColumns) sheet.setValue(`${col}${row}`, inputs[col] ?? null);
  }

  // 3. Clear sample data from template rows we did not use.
  if (config.clearUnusedRows) {
    for (let r = lastUsedRow + 1; r <= config.lastDataRow; r++) {
      for (const col of inputColumns) {
        if (col === config.columns.serial && config.serialMode === "renumber") {
          sheet.setValue(`${col}${r}`, r - config.firstDataRow + 1);
        } else {
          sheet.setValue(`${col}${r}`, null);
        }
      }
    }
  }

  // 4. Recompute cached values of every formula in the sheet.
  const formulaRefs = new Set(sheet.formulaCells());
  const memo = new Map<string, CellValue | undefined>();
  const visiting = new Set<string>();
  const getCell = (col: string, row: number): CellValue => {
    const ref = `${col}${row}`;
    if (!formulaRefs.has(ref)) return sheet.readCell(ref).value;
    if (memo.has(ref)) {
      const v = memo.get(ref);
      if (v === undefined) throw new Error("#CIRCULAR");
      return v;
    }
    if (visiting.has(ref)) throw new Error("#CIRCULAR");
    visiting.add(ref);
    const formula = sheet.readCell(ref).formula as string;
    const res = evaluateFormula(formula, { getCell });
    visiting.delete(ref);
    memo.set(ref, res.ok ? res.value : undefined);
    if (!res.ok) throw new Error(res.error);
    return res.value;
  };

  let uncomputed = 0;
  for (const ref of formulaRefs) {
    try {
      const { col, row } = splitRef(ref);
      sheet.setCachedValue(ref, getCell(col, row));
    } catch {
      uncomputed++;
      sheet.setCachedValue(ref, undefined);
    }
  }

  // 5. Highlight required cells left blank on rows marked "CHECK", so they
  //    are easy to find and fill in Excel. The highlight disappears as soon
  //    as a value is typed (conditional formatting, not a fixed colour).
  const { columns } = config;
  const checkCols = config.requiredFields.map((k) => columns[k]).filter((c): c is string => Boolean(c));
  if (columns.remarks && checkCols.length && laidOut.some((r) => /CHECK/.test(String(r.inputs[columns.remarks!] ?? "")))) {
    const dxf = await book.addFillDxf("FFFFC7CE", "FF9C0006");
    const first = config.firstDataRow;
    const last = Math.max(lastUsedRow, config.lastDataRow);
    const sqref = checkCols.map((c) => `${c}${first}:${c}${last}`).join(" ");
    sheet.addConditionalFormat(sqref, `AND(${checkCols[0]}${first}="",ISNUMBER(SEARCH("CHECK",$${columns.remarks}${first})))`, dxf);
  }

  const buffer = await book.toBuffer();
  return { buffer, rowsWritten: laidOut.length, rowsAdded, uncomputedFormulas: uncomputed };
}

export function outputFileName(date = new Date()): string {
  const iso = date.toISOString().slice(0, 10);
  return `converted_measurement_${iso}.xlsx`;
}
