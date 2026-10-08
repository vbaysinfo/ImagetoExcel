import { describe, expect, it } from "vitest";
import { evaluateFormula, type CellValue } from "../calc/formula";
import { shiftFormula } from "../calc/cellref";

const ctx = (cells: Record<string, CellValue>) => ({
  getCell: (col: string, row: number) => cells[`${col}${row}`] ?? null,
});

describe("formula evaluator", () => {
  it("evaluates the template's area/volume formula", () => {
    const f = 'IF(OR(D2="",E2=""),"",IF(F2="",D2*E2,D2*E2*F2))';
    expect(evaluateFormula(f, ctx({ D2: 8, E2: 7 }))).toEqual({ ok: true, value: 56 });
    expect(evaluateFormula(f, ctx({ D2: 5, E2: 2, F2: 1.6 }))).toEqual({ ok: true, value: 16 });
    expect(evaluateFormula(f, ctx({ D2: 5 }))).toEqual({ ok: true, value: "" });
  });

  it("evaluates the basis text formula", () => {
    const f = 'IF(OR(D2="",E2=""),"",IF(F2="","Area (Sq.ft)","Volume (Cu.ft)"))';
    expect(evaluateFormula(f, ctx({ D2: 1, E2: 1 }))).toEqual({ ok: true, value: "Area (Sq.ft)" });
    expect(evaluateFormula(f, ctx({ D2: 1, E2: 1, F2: 1 }))).toEqual({ ok: true, value: "Volume (Cu.ft)" });
  });

  it("handles precedence, ranges and functions", () => {
    expect(evaluateFormula("=1+2*3^2", ctx({}))).toEqual({ ok: true, value: 19 });
    expect(evaluateFormula("SUM(A1:A3)*2", ctx({ A1: 1, A2: 2, A3: "x" }))).toEqual({ ok: true, value: 6 });
    expect(evaluateFormula("ROUND(2.345,2)", ctx({}))).toEqual({ ok: true, value: 2.35 });
    expect(evaluateFormula('"a"&1', ctx({}))).toEqual({ ok: true, value: "a1" });
    expect(evaluateFormula("1/0", ctx({}))).toMatchObject({ ok: false, unsupported: false });
    expect(evaluateFormula("VLOOKUP(A1,B1:C2,2)", ctx({}))).toMatchObject({ ok: false, unsupported: true });
  });

  it("shifts relative references only", () => {
    expect(shiftFormula('IF(D2="","",D2*304.8)', 5, 0)).toBe('IF(D7="","",D7*304.8)');
    expect(shiftFormula("$A$1+A1+LOG10(B2)", 1, 1)).toBe("$A$1+B2+LOG10(C3)");
    expect(shiftFormula('"D2"&D2', 1, 0)).toBe('"D2"&D3');
  });
});
