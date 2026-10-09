/**
 * Minimal, formatting-preserving XLSX reader/writer.
 *
 * Rather than loading the workbook into a spreadsheet library and writing a
 * fresh file (which loses details such as shared formulas, theme colours,
 * print setup or conditional formats), this edits the original OOXML parts in
 * place: only the `<c>` elements we touch change. Everything else in the
 * template is byte-for-byte preserved.
 */
import JSZip from "jszip";
import { DOMParser, XMLSerializer, type Document, type Element } from "@xmldom/xmldom";
import { colToIndex, indexToCol, shiftFormula, splitRef } from "../calc/cellref";
import type { CellValue } from "../calc/formula";

const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const BUILTIN_NUMFMTS: Record<number, string> = {
  0: "General", 1: "0", 2: "0.00", 3: "#,##0", 4: "#,##0.00", 9: "0%", 10: "0.00%",
  11: "0.00E+00", 12: "# ?/?", 13: "# ??/??", 14: "mm-dd-yy", 15: "d-mmm-yy", 16: "d-mmm",
  17: "mmm-yy", 18: "h:mm AM/PM", 19: "h:mm:ss AM/PM", 20: "h:mm", 21: "h:mm:ss",
  22: "m/d/yy h:mm", 37: "#,##0 ;(#,##0)", 38: "#,##0 ;[Red](#,##0)", 39: "#,##0.00;(#,##0.00)",
  40: "#,##0.00;[Red](#,##0.00)", 45: "mm:ss", 46: "[h]:mm:ss", 47: "mmss.0", 48: "##0.0E+0", 49: "@",
};

function parseXml(xml: string): Document {
  return new DOMParser().parseFromString(xml, "text/xml");
}

function children(el: Element, localName: string): Element[] {
  const out: Element[] = [];
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (n as Element).localName === localName) out.push(n as Element);
  }
  return out;
}

function child(el: Element, localName: string): Element | null {
  return children(el, localName)[0] ?? null;
}

function textOf(el: Element | null): string {
  return el?.textContent ?? "";
}

export interface CellInfo {
  ref: string;
  value: CellValue;
  /** Formula text without the leading "=" (shared formulas expanded). */
  formula: string | null;
  styleId: number;
  numberFormat: string;
}

export class XlsxSheet {
  private rowIndex = new Map<number, Element>();
  private sharedMasters = new Map<string, { formula: string; col: number; row: number }>();
  private sheetData: Element;
  dirty = false;

  constructor(
    readonly name: string,
    readonly path: string,
    readonly doc: Document,
    private readonly book: XlsxWorkbook,
  ) {
    const data = doc.getElementsByTagName("sheetData")[0];
    if (!data) throw new Error(`Worksheet "${name}" has no sheetData`);
    this.sheetData = data as unknown as Element;
    for (const row of children(this.sheetData, "row")) {
      this.rowIndex.set(Number(row.getAttribute("r")), row);
      for (const c of children(row, "c")) {
        const f = child(c, "f");
        if (f && f.getAttribute("t") === "shared" && f.getAttribute("ref") && textOf(f)) {
          const { col, row: r } = splitRef(c.getAttribute("r") as string);
          this.sharedMasters.set(f.getAttribute("si") as string, {
            formula: textOf(f),
            col: colToIndex(col),
            row: r,
          });
        }
      }
    }
  }

  get rowNumbers(): number[] {
    return [...this.rowIndex.keys()].sort((a, b) => a - b);
  }

  get dimension(): string {
    const d = this.doc.getElementsByTagName("dimension")[0];
    return d?.getAttribute("ref") ?? "";
  }

  get mergedCells(): string[] {
    return Array.from(this.doc.getElementsByTagName("mergeCell")).map((m) => m.getAttribute("ref") ?? "");
  }

  get maxColumn(): number {
    let max = 0;
    for (const row of this.rowIndex.values()) {
      for (const c of children(row, "c")) max = Math.max(max, colToIndex(splitRef(c.getAttribute("r") as string).col));
    }
    return max;
  }

  private cellEl(ref: string): Element | null {
    const { row } = splitRef(ref);
    const rowEl = this.rowIndex.get(row);
    if (!rowEl) return null;
    return children(rowEl, "c").find((c) => c.getAttribute("r") === ref) ?? null;
  }

  private formulaOf(c: Element): string | null {
    const f = child(c, "f");
    if (!f) return null;
    const text = textOf(f);
    if (text) return text;
    if (f.getAttribute("t") === "shared") {
      const master = this.sharedMasters.get(f.getAttribute("si") as string);
      if (!master) return null;
      const { col, row } = splitRef(c.getAttribute("r") as string);
      return shiftFormula(master.formula, row - master.row, colToIndex(col) - master.col);
    }
    return null;
  }

  readCell(ref: string): CellInfo {
    const c = this.cellEl(ref);
    if (!c) return { ref, value: null, formula: null, styleId: 0, numberFormat: "General" };
    const styleId = Number(c.getAttribute("s") ?? 0);
    const t = c.getAttribute("t");
    const v = child(c, "v");
    let value: CellValue = null;
    if (t === "s") value = this.book.sharedString(Number(textOf(v)));
    else if (t === "inlineStr") value = textOf(child(c, "is"));
    else if (t === "str") value = textOf(v);
    else if (t === "b") value = textOf(v) === "1";
    else if (v && textOf(v) !== "") value = Number(textOf(v));
    return { ref, value, formula: this.formulaOf(c), styleId, numberFormat: this.book.numberFormat(styleId) };
  }

  /** Create the row (copying styles from `templateRow`) if it does not exist. */
  ensureRow(row: number, templateRow: number): void {
    if (this.rowIndex.has(row)) return;
    const source = this.rowIndex.get(templateRow);
    const newRow = source
      ? (source.cloneNode(true) as Element)
      : (this.doc.createElementNS(MAIN_NS, "row") as unknown as Element);
    newRow.setAttribute("r", String(row));
    for (const c of children(newRow, "c")) {
      const { col } = splitRef(c.getAttribute("r") as string);
      const sourceRef = `${col}${templateRow}`;
      const sourceCell = this.cellEl(sourceRef);
      const formula = sourceCell ? this.formulaOf(sourceCell) : null;
      c.setAttribute("r", `${col}${row}`);
      // Drop values and formulas; formulas are re-added explicitly (never as
      // shared-formula children, whose master range would not cover them).
      for (const n of [...children(c, "f"), ...children(c, "v"), ...children(c, "is")]) c.removeChild(n);
      c.removeAttribute("t");
      if (formula) {
        const f = this.doc.createElementNS(MAIN_NS, "f");
        f.appendChild(this.doc.createTextNode(shiftFormula(formula, row - templateRow, 0)));
        c.appendChild(f);
      }
    }
    // Insert in row order.
    const after = this.rowNumbers.filter((r) => r > row)[0];
    if (after !== undefined) this.sheetData.insertBefore(newRow, this.rowIndex.get(after) as Element);
    else this.sheetData.appendChild(newRow);
    this.rowIndex.set(row, newRow);
    this.updateDimension();
    this.dirty = true;
  }

  private getOrCreateCell(ref: string): Element {
    const existing = this.cellEl(ref);
    if (existing) return existing;
    const { col, row } = splitRef(ref);
    let rowEl = this.rowIndex.get(row);
    if (!rowEl) {
      rowEl = this.doc.createElementNS(MAIN_NS, "row") as unknown as Element;
      rowEl.setAttribute("r", String(row));
      const after = this.rowNumbers.filter((r) => r > row)[0];
      if (after !== undefined) this.sheetData.insertBefore(rowEl, this.rowIndex.get(after) as Element);
      else this.sheetData.appendChild(rowEl);
      this.rowIndex.set(row, rowEl);
    }
    const c = this.doc.createElementNS(MAIN_NS, "c") as unknown as Element;
    c.setAttribute("r", ref);
    const colIdx = colToIndex(col);
    const next = children(rowEl, "c").find((x) => colToIndex(splitRef(x.getAttribute("r") as string).col) > colIdx);
    if (next) rowEl.insertBefore(c, next);
    else rowEl.appendChild(c);
    return c;
  }

  /** Write a constant value, keeping the cell's style. Removes any formula. */
  setValue(ref: string, value: CellValue): void {
    const c = this.getOrCreateCell(ref);
    for (const n of [...children(c, "f"), ...children(c, "v"), ...children(c, "is")]) c.removeChild(n);
    c.removeAttribute("t");
    if (value === null || value === "") {
      // Empty, styled cell.
    } else if (typeof value === "number") {
      const v = this.doc.createElementNS(MAIN_NS, "v");
      v.appendChild(this.doc.createTextNode(String(value)));
      c.appendChild(v);
    } else if (typeof value === "boolean") {
      c.setAttribute("t", "b");
      const v = this.doc.createElementNS(MAIN_NS, "v");
      v.appendChild(this.doc.createTextNode(value ? "1" : "0"));
      c.appendChild(v);
    } else {
      c.setAttribute("t", "inlineStr");
      const is = this.doc.createElementNS(MAIN_NS, "is");
      const t = this.doc.createElementNS(MAIN_NS, "t");
      if (/^\s|\s$|\n/.test(value)) t.setAttribute("xml:space", "preserve");
      t.appendChild(this.doc.createTextNode(value));
      is.appendChild(t);
      c.appendChild(is);
    }
    this.dirty = true;
  }

  /** Update the cached result of a formula cell (the formula itself is kept). */
  setCachedValue(ref: string, value: CellValue | undefined): void {
    const c = this.cellEl(ref);
    if (!c || !child(c, "f")) return;
    for (const n of children(c, "v")) c.removeChild(n);
    c.removeAttribute("t");
    if (value === undefined) {
      // Unknown: leave no cached value, Excel computes it on open.
      this.dirty = true;
      return;
    }
    const v = this.doc.createElementNS(MAIN_NS, "v");
    if (typeof value === "number") v.appendChild(this.doc.createTextNode(String(value)));
    else if (typeof value === "boolean") {
      c.setAttribute("t", "b");
      v.appendChild(this.doc.createTextNode(value ? "1" : "0"));
    } else {
      c.setAttribute("t", "str");
      v.appendChild(this.doc.createTextNode(value ?? ""));
    }
    c.appendChild(v);
    this.dirty = true;
  }

  /**
   * Add a formula-based conditional format (e.g. highlight cells that still
   * need a value). Inserted at the position the OOXML schema requires.
   */
  addConditionalFormat(sqref: string, formula: string, dxfId: number): void {
    const root = this.doc.documentElement as unknown as Element;
    let priority = 1;
    for (const r of Array.from(this.doc.getElementsByTagName("cfRule"))) {
      priority = Math.max(priority, Number(r.getAttribute("priority") ?? 0) + 1);
    }
    const cf = this.doc.createElementNS(MAIN_NS, "conditionalFormatting");
    cf.setAttribute("sqref", sqref);
    const rule = this.doc.createElementNS(MAIN_NS, "cfRule");
    rule.setAttribute("type", "expression");
    rule.setAttribute("dxfId", String(dxfId));
    rule.setAttribute("priority", String(priority));
    const f = this.doc.createElementNS(MAIN_NS, "formula");
    f.appendChild(this.doc.createTextNode(formula));
    rule.appendChild(f);
    cf.appendChild(rule);
    // Elements that must come after <conditionalFormatting>.
    const after = [
      "dataValidations", "hyperlinks", "printOptions", "pageMargins", "pageSetup", "headerFooter", "rowBreaks",
      "colBreaks", "customProperties", "cellWatches", "ignoredErrors", "smartTags", "drawing", "legacyDrawing",
      "legacyDrawingHF", "picture", "oleObjects", "controls", "webPublishItems", "tableParts", "extLst",
    ];
    let before: Element | null = null;
    for (let n = root.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 1 && after.includes((n as Element).localName ?? "")) {
        before = n as Element;
        break;
      }
    }
    if (before) root.insertBefore(cf, before);
    else root.appendChild(cf);
    this.dirty = true;
  }

  /** All formula cells in the sheet (refs). */
  formulaCells(): string[] {
    const out: string[] = [];
    for (const row of this.rowIndex.values()) {
      for (const c of children(row, "c")) if (child(c, "f")) out.push(c.getAttribute("r") as string);
    }
    return out;
  }

  columnWidths(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const col of Array.from(this.doc.getElementsByTagName("col"))) {
      const min = Number(col.getAttribute("min"));
      const max = Number(col.getAttribute("max"));
      for (let i = min; i <= max && i <= 200; i++) out[indexToCol(i)] = Number(col.getAttribute("width"));
    }
    return out;
  }

  private updateDimension(): void {
    const d = this.doc.getElementsByTagName("dimension")[0];
    if (!d) return;
    const rows = this.rowNumbers;
    const last = rows[rows.length - 1] ?? 1;
    const ref = d.getAttribute("ref") ?? "A1";
    const [start, end] = ref.split(":");
    if (!end) return;
    const { col } = splitRef(end);
    d.setAttribute("ref", `${start}:${col}${Math.max(last, splitRef(end).row)}`);
  }
}

export class XlsxWorkbook {
  private sheets = new Map<string, XlsxSheet>();
  private sheetPaths: { name: string; path: string }[] = [];
  private strings: string[] = [];
  private styleNumFmt: string[] = [];
  private stylesDoc: Document | null = null;

  private constructor(private zip: JSZip, private workbookDoc: Document) {}

  static async load(data: ArrayBuffer | Uint8Array | Buffer): Promise<XlsxWorkbook> {
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(data);
    } catch {
      throw new Error("The file is not a valid .xlsx workbook.");
    }
    const wbXml = await zip.file("xl/workbook.xml")?.async("string");
    if (!wbXml) throw new Error("The file is not a valid .xlsx workbook (xl/workbook.xml missing).");
    const book = new XlsxWorkbook(zip, parseXml(wbXml));
    await book.init();
    return book;
  }

  private async init(): Promise<void> {
    const relsXml = await this.zip.file("xl/_rels/workbook.xml.rels")?.async("string");
    const rels = new Map<string, string>();
    if (relsXml) {
      for (const r of Array.from(parseXml(relsXml).getElementsByTagName("Relationship"))) {
        const target = r.getAttribute("Target") ?? "";
        rels.set(r.getAttribute("Id") ?? "", target.startsWith("/") ? target.slice(1) : `xl/${target}`);
      }
    }
    for (const s of Array.from(this.workbookDoc.getElementsByTagName("sheet"))) {
      const id = s.getAttributeNS(REL_NS, "id") || s.getAttribute("r:id") || "";
      const path = rels.get(id);
      if (path) this.sheetPaths.push({ name: s.getAttribute("name") ?? "", path });
    }

    const sst = await this.zip.file("xl/sharedStrings.xml")?.async("string");
    if (sst) {
      const doc = parseXml(sst);
      for (const si of Array.from(doc.getElementsByTagName("si"))) {
        // Concatenate all <t> runs (rich text), ignoring phonetic runs.
        let s = "";
        for (const t of Array.from(si.getElementsByTagName("t"))) {
          if ((t.parentNode as Element | null)?.localName === "rPh") continue;
          s += t.textContent ?? "";
        }
        this.strings.push(s);
      }
    }

    const stylesXml = await this.zip.file("xl/styles.xml")?.async("string");
    if (stylesXml) {
      const doc = parseXml(stylesXml);
      const custom = new Map<number, string>();
      for (const nf of Array.from(doc.getElementsByTagName("numFmt"))) {
        custom.set(Number(nf.getAttribute("numFmtId")), nf.getAttribute("formatCode") ?? "General");
      }
      const cellXfs = doc.getElementsByTagName("cellXfs")[0];
      if (cellXfs) {
        for (const xf of children(cellXfs as unknown as Element, "xf")) {
          const id = Number(xf.getAttribute("numFmtId") ?? 0);
          this.styleNumFmt.push(custom.get(id) ?? BUILTIN_NUMFMTS[id] ?? "General");
        }
      }
    }
  }

  get sheetNames(): string[] {
    return this.sheetPaths.map((s) => s.name);
  }

  sharedString(i: number): string {
    return this.strings[i] ?? "";
  }

  numberFormat(styleId: number): string {
    return this.styleNumFmt[styleId] ?? "General";
  }

  async sheet(name: string): Promise<XlsxSheet> {
    const cached = this.sheets.get(name);
    if (cached) return cached;
    const entry = this.sheetPaths.find((s) => s.name === name);
    if (!entry) throw new Error(`Sheet "${name}" was not found in the workbook.`);
    const xml = await this.zip.file(entry.path)?.async("string");
    if (!xml) throw new Error(`Sheet "${name}" could not be read.`);
    const sheet = new XlsxSheet(name, entry.path, parseXml(xml), this);
    this.sheets.set(name, sheet);
    return sheet;
  }

  /**
   * Ask Excel to recalculate everything on open and drop the calculation
   * chain (it lists formula cells and must not reference cells that moved).
   */
  private async forceRecalculation(): Promise<void> {
    let calcPr = this.workbookDoc.getElementsByTagName("calcPr")[0];
    if (!calcPr) {
      calcPr = this.workbookDoc.createElementNS(MAIN_NS, "calcPr");
      const root = this.workbookDoc.documentElement as unknown as Element;
      // calcPr goes after <sheets>/<definedNames>; appending before extLst is valid.
      const ext = child(root, "extLst");
      if (ext) root.insertBefore(calcPr, ext);
      else root.appendChild(calcPr);
    }
    calcPr.setAttribute("fullCalcOnLoad", "1");

    if (this.zip.file("xl/calcChain.xml")) {
      this.zip.remove("xl/calcChain.xml");
      const ctPath = "[Content_Types].xml";
      const ct = await this.zip.file(ctPath)?.async("string");
      if (ct) {
        const doc = parseXml(ct);
        for (const o of Array.from(doc.getElementsByTagName("Override"))) {
          if (o.getAttribute("PartName") === "/xl/calcChain.xml") o.parentNode?.removeChild(o);
        }
        this.zip.file(ctPath, new XMLSerializer().serializeToString(doc));
      }
      const relsPath = "xl/_rels/workbook.xml.rels";
      const rels = await this.zip.file(relsPath)?.async("string");
      if (rels) {
        const doc = parseXml(rels);
        for (const r of Array.from(doc.getElementsByTagName("Relationship"))) {
          if ((r.getAttribute("Target") ?? "").endsWith("calcChain.xml")) r.parentNode?.removeChild(r);
        }
        this.zip.file(relsPath, new XMLSerializer().serializeToString(doc));
      }
    }
  }

  /** Add a differential style (used by conditional formats) with a solid fill; returns its id. */
  async addFillDxf(argb: string, fontArgb?: string): Promise<number> {
    if (!this.stylesDoc) {
      const xml = await this.zip.file("xl/styles.xml")?.async("string");
      if (!xml) throw new Error("The workbook has no styles part.");
      this.stylesDoc = parseXml(xml);
    }
    const doc = this.stylesDoc;
    const root = doc.documentElement as unknown as Element;
    let dxfs = child(root, "dxfs");
    if (!dxfs) {
      dxfs = doc.createElementNS(MAIN_NS, "dxfs") as unknown as Element;
      // <dxfs> follows <cellStyles>; place it before tableStyles/colors/extLst.
      const next = child(root, "tableStyles") ?? child(root, "colors") ?? child(root, "extLst");
      if (next) root.insertBefore(dxfs, next);
      else root.appendChild(dxfs);
    }
    const dxf = doc.createElementNS(MAIN_NS, "dxf");
    if (fontArgb) {
      const font = doc.createElementNS(MAIN_NS, "font");
      const color = doc.createElementNS(MAIN_NS, "color");
      color.setAttribute("rgb", fontArgb);
      font.appendChild(color);
      dxf.appendChild(font);
    }
    const fill = doc.createElementNS(MAIN_NS, "fill");
    const pattern = doc.createElementNS(MAIN_NS, "patternFill");
    pattern.setAttribute("patternType", "solid");
    const bg = doc.createElementNS(MAIN_NS, "bgColor");
    bg.setAttribute("rgb", argb);
    pattern.appendChild(bg);
    fill.appendChild(pattern);
    dxf.appendChild(fill);
    dxfs.appendChild(dxf);
    const count = children(dxfs, "dxf").length;
    dxfs.setAttribute("count", String(count));
    return count - 1;
  }

  async toBuffer(): Promise<Buffer> {
    const serializer = new XMLSerializer();
    let changed = false;
    if (this.stylesDoc) this.zip.file("xl/styles.xml", serializer.serializeToString(this.stylesDoc));
    for (const sheet of this.sheets.values()) {
      if (!sheet.dirty) continue;
      changed = true;
      this.zip.file(sheet.path, serializer.serializeToString(sheet.doc));
    }
    if (changed) {
      await this.forceRecalculation();
      this.zip.file("xl/workbook.xml", serializer.serializeToString(this.workbookDoc));
    }
    return this.zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  }
}
