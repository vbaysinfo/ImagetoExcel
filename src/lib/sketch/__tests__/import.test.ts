import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeTemplate } from "../excel/analyzeTemplate";
import { generateWorkbook } from "../excel/generate";
import { importRows } from "../excel/importRows";
import { checkNote, emptyMeasurement, newManualItem, toGenerateRows } from "../review";

const file = readFileSync(path.join(process.cwd(), "templates/default/template.xlsx"));
const meta = { id: "default", name: "t", fileName: "t.xlsx", uploadedAt: null, builtIn: true };

describe("excel import", () => {
  it("reads the sample template's rows, carrying room names down", async () => {
    const p = await analyzeTemplate(file, meta);
    const items = await importRows(file, p);
    expect(items.length).toBe(45);
    expect(items[0]).toMatchObject({ room: "MBR", item: "Wardrobe Shutter", width: { value: 8, unit: "ft" }, height: { value: 7 } });
    expect(items[1]).toMatchObject({ room: "MBR", item: "Loft" });
    expect(items[2].depth.value).toBe(1.6);
  });

  it("round-trips a draft export, dropping the CHECK note", async () => {
    const p = await analyzeTemplate(file, meta);
    const it = newManualItem(1, "mm", "GBR");
    it.item = "Wardrobe";
    it.width = { ...emptyMeasurement("mm"), value: 2330, source: "detected", confidence: 70, needsReview: true };
    expect(checkNote(it, p.config)).toBe("⚠ CHECK: width 2,330 mm?; height missing");
    const rows = toGenerateRows([it], p.config, { markChecks: true });
    expect(rows[0].remarks).toContain("⚠ CHECK");
    const { buffer } = await generateWorkbook(file, p, rows);
    const [back] = await importRows(buffer, p);
    expect(back).toMatchObject({ room: "GBR", item: "Wardrobe", width: { value: 7.64, unit: "ft" }, height: { value: null } });
    expect(back.remarks).toBe("Sketch: 2330 mm");
    // The CHECK note comes back as review flags in the editor.
    expect(back.height).toMatchObject({ needsReview: true, issues: ["Not written on the sketch — please enter it."] });
    expect(back.width.needsReview).toBe(true);
    expect(back.confirmed).toBe(false);
    expect(back.question).toContain("height missing");
  });
});

describe("blank-cell highlight", () => {
  it("adds a conditional format for blank required cells on CHECK rows", async () => {
    const JSZip = (await import("jszip")).default;
    const p = await analyzeTemplate(file, meta);
    const it = newManualItem(1, "mm", "GBR");
    it.item = "Loft";
    it.width = { ...emptyMeasurement("mm"), value: 2330, source: "manual", confidence: 100 };
    const { buffer } = await generateWorkbook(file, p, toGenerateRows([it], p.config, { markChecks: true }));
    const zip = await JSZip.loadAsync(buffer);
    const sheetXml = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
    const styles = await zip.file("xl/styles.xml")!.async("string");
    expect(sheetXml).toContain('<conditionalFormatting sqref="D2:D54 E2:E54">');
    expect(sheetXml).toContain('AND(D2="",ISNUMBER(SEARCH("CHECK",$L2)))');
    // Must precede pageMargins to keep the file valid.
    expect(sheetXml.indexOf("<conditionalFormatting")).toBeLessThan(sheetXml.indexOf("<pageMargins"));
    expect(styles).toMatch(/<dxfs count="\d+">[\s\S]*FFFFC7CE/);
  });
});
