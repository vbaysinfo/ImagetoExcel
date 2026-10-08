"use client";

import { cn } from "@/lib/utils";
import { computeRow, layoutRows } from "@/lib/sketch/calc/engine";
import { toGenerateRows } from "@/lib/sketch/review";
import type { LineItem, TemplateProfile } from "@/lib/sketch/types";
import type { CellValue } from "@/lib/sketch/calc/formula";

function show(v: CellValue | undefined, numberFormat: string): string {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number") {
    const m = /^0(?:\.(0+))?$/.exec(numberFormat);
    if (m) return v.toFixed(m[1]?.length ?? 0);
    return String(Math.round(v * 10000) / 10000);
  }
  return String(v);
}

/** A faithful preview of the rows as they will appear in the template sheet. */
export function ExcelPreview({ items, profile }: { items: LineItem[]; profile: TemplateProfile }) {
  const { config, columns } = profile;
  const rows = layoutRows(toGenerateRows(items, config), config);
  const cols = columns;

  return (
    <div>
      <p className="mb-2 text-xs text-stone-500">
        Preview of sheet <b>{config.sheet}</b>, rows {config.firstDataRow}–{config.firstDataRow + rows.length - 1}. Grey columns are the template&apos;s own
        formulas.
      </p>
      <div className="max-h-80 overflow-auto rounded-xl border border-stone-200">
        <table className="min-w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="border border-stone-300 bg-stone-100 px-1.5 py-1 text-stone-400">{config.headerRow}</th>
              {cols.map((c) => (
                <th key={c.column} className="whitespace-pre-line border border-stone-300 bg-[#2E75B6] px-2 py-1 text-center font-semibold text-white">
                  {c.header || c.column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const computed = computeRow(r, profile);
              return (
                <tr key={r.row}>
                  <td className="border border-stone-300 bg-stone-100 px-1.5 py-1 text-center text-stone-400">{r.row}</td>
                  {cols.map((c) => {
                    const isInput = c.column in r.inputs;
                    const comp = computed.find((x) => x.column === c.column);
                    const v = isInput ? r.inputs[c.column] : comp?.value;
                    return (
                      <td
                        key={c.column}
                        className={cn(
                          "whitespace-nowrap border border-stone-300 px-2 py-1",
                          c.formula ? "bg-[#F2F2F2] text-center" : "bg-[#FFF2CC]",
                          isInput && typeof v === "number" && "text-center text-[#0000FF]",
                          isInput && typeof v !== "number" && "text-[#0000FF]",
                        )}
                      >
                        {show(v, c.numberFormat)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
