import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeTemplate } from "../excel/analyzeTemplate";
import { generateWorkbook } from "../excel/generate";
import { XlsxWorkbook } from "../excel/xlsx";
import type { GenerateRow } from "../types";

const file = readFileSync(path.join(process.cwd(), "templates/default/template.xlsx"));
const meta = { id: "default", name: "t", fileName: "t.xlsx", uploadedAt: null, builtIn: true };

const row = (i: number, depthMm: number | null = null): GenerateRow => ({
  room: i < 2 ? "MBR" : "GBR",
  item: `Item ${i}`,
  widthMm: 2438.4, // 8 ft
  heightMm: 2133.6, // 7 ft
  depthMm,
  remarks: "",
});

describe("template analysis", () => {
  it("detects the sample template's layout", async () => {
    const p = await analyzeTemplate(file, meta);
    expect(p.config).toMatchObject({
      sheet: "Price Calculator",
      headerRow: 1,
      firstDataRow: 2,
      lastDataRow: 54,
      inputUnit: "ft",
      requiredFields: ["width", "height"],
      roomMode: "first-of-group",
      columns: { serial: "A", room: "B", item: "C", width: "D", height: "E", depth: "F", remarks: "L" },
    });
    expect(p.columns.filter((c) => c.formula).map((c) => c.column)).toEqual(["G", "H", "I", "J", "K"]);
    expect(p.exampleRows.length).toBeGreaterThan(30);
  });
});

describe("excel generation", () => {
  it("fills a copy of the template and keeps formulas", async () => {
    const p = await analyzeTemplate(file, meta);
    const { buffer } = await generateWorkbook(file, p, [row(0), row(1, 304.8), row(2)]);
    const sheet = await (await XlsxWorkbook.load(buffer)).sheet("Price Calculator");
    expect(sheet.readCell("B2").value).toBe("MBR");
    expect(sheet.readCell("B3").value).toBeNull(); // same room → only on first row
    expect(sheet.readCell("B4").value).toBe("GBR");
    expect(sheet.readCell("D2").value).toBe(8);
    expect(sheet.readCell("K2")).toMatchObject({ value: 56, formula: 'IF(OR(D2="",E2=""),"",IF(F2="",D2*E2,D2*E2*F2))' });
    expect(sheet.readCell("J3").value).toBe("Volume (Cu.ft)");
    expect(sheet.readCell("K3").value).toBe(56);
    // Sample data cleared from unused rows, formulas still there.
    expect(sheet.readCell("C5").value).toBeNull();
    expect(sheet.readCell("K5").formula).toBe('IF(OR(D5="",E5=""),"",IF(F5="",D5*E5,D5*E5*F5))');
    expect(sheet.readCell("A5").value).toBe(4);
    // Original template untouched.
    const original = await (await XlsxWorkbook.load(file)).sheet("Price Calculator");
    expect(original.readCell("C2").value).toBe("Wardrobe Shutter");
  });

  it("adds styled rows beyond the template", async () => {
    const p = await analyzeTemplate(file, meta);
    const rows = Array.from({ length: 60 }, (_, i) => row(i));
    const { buffer, rowsAdded } = await generateWorkbook(file, p, rows);
    expect(rowsAdded).toBe(7);
    const sheet = await (await XlsxWorkbook.load(buffer)).sheet("Price Calculator");
    expect(sheet.readCell("K61")).toMatchObject({ value: 56, formula: 'IF(OR(D61="",E61=""),"",IF(F61="",D61*E61,D61*E61*F61))' });
    expect(sheet.readCell("D61").styleId).toBe(sheet.readCell("D54").styleId);
  });
});
