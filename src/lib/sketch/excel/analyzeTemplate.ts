/**
 * Template inspection: works out how an uploaded Excel sample is laid out —
 * which sheet and header row hold the table, which columns are inputs and
 * which are formulas, what units the headers declare — and proposes a
 * mapping. A saved mapping (edited by the administrator) always wins over the
 * guesses made here.
 */
import { XlsxWorkbook, type XlsxSheet } from "./xlsx";
import { indexToCol } from "../calc/cellref";
import type {
  ColumnMapping,
  DimensionKey,
  MappingField,
  TemplateColumnInfo,
  TemplateConfig,
  TemplateProfile,
} from "../types";
import { unitFromHeader } from "../units";

const FIELD_PATTERNS: [MappingField, RegExp][] = [
  ["serial", /^(s\.?\s*no|sl\.?\s*no|sr\.?\s*no|serial|#|no\.?)\b/i],
  ["room", /\b(room|location|space|area name|zone)\b/i],
  ["item", /\b(item|description|furniture|particulars?|component|element)\b/i],
  ["width", /\b(width|length|wide|breadth|w)\b/i],
  ["height", /\b(height|high|h)\b/i],
  ["depth", /\b(depth|deep|d)\b/i],
  ["remarks", /\b(remarks?|notes?|comments?)\b/i],
];

function headerText(v: unknown): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
}

function isAutoHeader(header: string): boolean {
  return /\bauto\b|\bcalc|formula/i.test(header);
}

function guessField(header: string): MappingField | null {
  if (!header || isAutoHeader(header)) return null;
  for (const [field, re] of FIELD_PATTERNS) if (re.test(header)) return field;
  return null;
}

async function findHeaderRow(sheet: XlsxSheet, maxCol: number): Promise<{ row: number; score: number }> {
  let best = { row: 1, score: -1 };
  for (const r of sheet.rowNumbers.slice(0, 20)) {
    let score = 0;
    for (let c = 1; c <= maxCol; c++) {
      const h = headerText(sheet.readCell(`${indexToCol(c)}${r}`).value);
      if (h && guessField(h)) score += 2;
      else if (h) score += 0.25;
    }
    if (score > best.score) best = { row: r, score };
  }
  return best;
}

function decimalsOf(n: number): number {
  const s = String(n);
  const i = s.indexOf(".");
  return i === -1 ? 0 : s.length - i - 1;
}

export async function analyzeTemplate(
  data: ArrayBuffer | Uint8Array | Buffer,
  meta: { id: string; name: string; fileName: string; uploadedAt: string | null; builtIn: boolean },
  saved?: Partial<TemplateConfig>,
): Promise<TemplateProfile> {
  const book = await XlsxWorkbook.load(data);
  if (book.sheetNames.length === 0) throw new Error("The workbook has no worksheets.");

  const sheets: TemplateProfile["sheets"] = [];
  let chosen: { sheet: XlsxSheet; headerRow: number; score: number } | null = null;
  for (const name of book.sheetNames) {
    const sheet = await book.sheet(name);
    const maxCol = sheet.maxColumn;
    const rows = sheet.rowNumbers;
    sheets.push({ name, dimension: sheet.dimension, rows: rows[rows.length - 1] ?? 0, columns: maxCol });
    const header = await findHeaderRow(sheet, maxCol);
    const preferred = saved?.sheet === name;
    if (preferred || (!saved?.sheet && (!chosen || header.score > chosen.score))) {
      chosen = { sheet, headerRow: header.row, score: header.score };
      if (preferred) break;
    }
  }
  if (!chosen) throw new Error(`Sheet "${saved?.sheet}" was not found in the workbook.`);

  const { sheet } = chosen;
  const headerRow = saved?.headerRow ?? chosen.headerRow;
  const firstDataRow = saved?.firstDataRow ?? headerRow + 1;
  const rowNumbers = sheet.rowNumbers;
  const lastDataRow = saved?.lastDataRow ?? Math.max(firstDataRow, rowNumbers[rowNumbers.length - 1] ?? firstDataRow);
  const maxCol = sheet.maxColumn;

  // Column inspection.
  const columns: TemplateColumnInfo[] = [];
  const guessed: ColumnMapping = {};
  for (let c = 1; c <= maxCol; c++) {
    const col = indexToCol(c);
    const header = headerText(sheet.readCell(`${col}${headerRow}`).value);
    const first = sheet.readCell(`${col}${firstDataRow}`);
    const role: TemplateColumnInfo["role"] = first.formula ? "formula" : header ? "input" : "static";
    columns.push({
      column: col,
      header,
      formula: first.formula,
      numberFormat: first.numberFormat,
      unit: unitFromHeader(header),
      role,
    });
    if (role === "input") {
      const field = guessField(header);
      if (field && !guessed[field]) guessed[field] = col;
    }
  }

  const mapping: ColumnMapping = { ...guessed, ...(saved?.columns ?? {}) };

  // Unit: whatever the width/height/depth headers declare.
  const dimUnit =
    columns.find((c) => c.column === mapping.width)?.unit ??
    columns.find((c) => c.column === mapping.height)?.unit ??
    columns.find((c) => c.column === mapping.depth)?.unit ??
    null;

  // Example rows already in the template (few-shot examples for the AI).
  const exampleRows: TemplateProfile["exampleRows"] = [];
  let maxDecimals = 0;
  let blankRoomAfterRoom = false;
  let lastRoom = "";
  for (let r = firstDataRow; r <= lastDataRow && exampleRows.length < 60; r++) {
    const read = (col?: string) => (col ? sheet.readCell(`${col}${r}`).value : null);
    const num = (v: unknown) => (typeof v === "number" ? v : null);
    const item = headerText(read(mapping.item));
    const room = headerText(read(mapping.room));
    const width = num(read(mapping.width));
    const height = num(read(mapping.height));
    const depth = num(read(mapping.depth));
    if (!item && width === null && height === null) continue;
    if (!room && lastRoom) blankRoomAfterRoom = true;
    if (room) lastRoom = room;
    for (const n of [width, height, depth]) if (n !== null) maxDecimals = Math.max(maxDecimals, decimalsOf(n));
    exampleRows.push({ room: room || lastRoom, item, width, height, depth });
  }

  const requiredFields: DimensionKey[] = (["width", "height", "depth"] as DimensionKey[]).filter((k) => {
    const col = mapping[k];
    if (!col) return false;
    const header = columns.find((c) => c.column === col)?.header ?? "";
    return !/blank|optional|if any/i.test(header);
  });

  const config: TemplateConfig = {
    sheet: sheet.name,
    headerRow,
    firstDataRow,
    lastDataRow,
    inputUnit: dimUnit ?? "mm",
    decimals: Math.min(4, Math.max(2, maxDecimals)),
    requiredFields,
    roomMode: blankRoomAfterRoom ? "first-of-group" : "every-row",
    serialMode: mapping.serial ? "renumber" : "keep",
    remarksMode: mapping.remarks ? "source-dimensions" : "none",
    clearUnusedRows: true,
    ...saved,
    id: meta.id,
    name: saved?.name ?? meta.name,
    columns: mapping,
  };

  // Findings for the inspection report.
  const findings: string[] = [];
  findings.push(
    `Sheet "${sheet.name}" holds a table with its header on row ${headerRow}; data rows ${firstDataRow}–${lastDataRow} are pre-formatted.`,
  );
  const inputCols = columns.filter((c) => c.role === "input");
  findings.push(`Input columns: ${inputCols.map((c) => `${c.column} "${c.header}"`).join(", ")}.`);
  const formulaCols = columns.filter((c) => c.formula);
  if (formulaCols.length) {
    findings.push(
      `Formula columns (preserved and recalculated): ${formulaCols.map((c) => `${c.column} = ${c.formula}`).join("; ")}.`,
    );
  }
  if (dimUnit) {
    findings.push(`Dimension inputs are in ${dimUnit}; sketch measurements are converted to ${dimUnit} with ${config.decimals} decimals.`);
  } else {
    findings.push("No unit found in the dimension headers — assuming millimetres. Set the unit in the mapping if this is wrong.");
  }
  const optional = (["width", "height", "depth"] as DimensionKey[]).filter((k) => mapping[k] && !requiredFields.includes(k));
  if (optional.length) findings.push(`Optional dimensions (may be left blank): ${optional.join(", ")}.`);
  if (config.roomMode === "first-of-group") findings.push("Room names are written only on the first row of each room group.");
  for (const field of ["item", "width", "height"] as MappingField[]) {
    if (!mapping[field]) findings.push(`⚠ No column was identified for "${field}". Set it in the mapping.`);
  }
  if (sheet.mergedCells.length) findings.push(`Merged cells preserved: ${sheet.mergedCells.join(", ")}.`);
  if (book.sheetNames.length > 1) findings.push(`Other sheets are copied unchanged: ${book.sheetNames.filter((n) => n !== sheet.name).join(", ")}.`);

  return {
    config,
    sheets,
    columns,
    mergedCells: sheet.mergedCells,
    exampleRows,
    findings,
    fileName: meta.fileName,
    uploadedAt: meta.uploadedAt,
    builtIn: meta.builtIn,
  };
}
