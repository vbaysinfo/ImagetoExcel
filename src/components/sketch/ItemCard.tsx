"use client";

import { ArrowDown, ArrowUp, HelpCircle, Info, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DimensionKey, LengthUnit, LineItem, TemplateProfile } from "@/lib/sketch/types";
import { DIMENSION_KEYS, LENGTH_UNITS } from "@/lib/sketch/types";
import { computeRow, layoutRows } from "@/lib/sketch/calc/engine";
import { toGenerateRows } from "@/lib/sketch/review";
import { formatNumber, UNIT_LABELS } from "@/lib/sketch/units";
import { MeasurementField } from "./MeasurementField";

const LABELS: Record<DimensionKey, string> = { width: "Width", height: "Height", depth: "Depth" };

export function ItemCard({
  item,
  index,
  total,
  profile,
  color,
  imageLabel,
  highlighted,
  onChange,
  onRemove,
  onMove,
  onHover,
}: {
  item: LineItem;
  index: number;
  total: number;
  profile: TemplateProfile;
  color: string;
  imageLabel: string | null;
  highlighted: boolean;
  onChange: (item: LineItem) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  onHover: (target: { itemId: string; field: DimensionKey | null } | null) => void;
}) {
  const { config } = profile;
  const unit = item.width.unit;

  // Live preview of exactly what this row becomes in the template.
  const [cells] = layoutRows(toGenerateRows([item], config), { ...config, roomMode: "every-row" });
  const computed = computeRow(cells, profile);
  const tplVal = (k: DimensionKey) => {
    const col = config.columns[k];
    return col ? (cells.inputs[col] as number | null) : null;
  };

  const setUnit = (u: LengthUnit) =>
    onChange({
      ...item,
      width: { ...item.width, unit: u },
      height: { ...item.height, unit: u },
      depth: { ...item.depth, unit: u },
    });

  return (
    <article
      id={`row-${item.id}`}
      className={cn(
        "scroll-mt-24 rounded-2xl border bg-white p-4 shadow-sm transition-shadow sm:p-5",
        highlighted ? "border-amber-500 ring-2 ring-amber-500/30" : "border-stone-200",
      )}
      onMouseEnter={() => onHover({ itemId: item.id, field: null })}
      onMouseLeave={() => onHover(null)}
    >
      <header className="mb-3 flex flex-wrap items-start gap-2">
        <span
          className="mt-1 inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-bold text-white"
          style={{ background: color }}
          aria-label={`Row ${index + 1}`}
        >
          {index + 1}
        </span>
        <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <input
            list="sketch-rooms"
            value={item.room}
            onChange={(e) => onChange({ ...item, room: e.target.value })}
            placeholder="Room (e.g. MBR)"
            aria-label="Room"
            className="rounded-lg border border-stone-300 px-2.5 py-1.5 text-sm outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20"
          />
          <input
            list="sketch-items"
            value={item.item}
            onChange={(e) => onChange({ ...item, item: e.target.value })}
            placeholder="Item / description (e.g. Wardrobe Shutter)"
            aria-label="Item description"
            className={cn(
              "rounded-lg border px-2.5 py-1.5 text-sm font-medium outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20",
              item.item.trim() ? "border-stone-300" : "border-red-300 bg-red-50/40",
            )}
          />
        </div>
        <div className="flex items-center gap-1">
          <select
            value={unit}
            onChange={(e) => setUnit(e.target.value as LengthUnit)}
            aria-label="Unit of the values on this row"
            className="rounded-lg border border-stone-300 bg-white px-1.5 py-1.5 text-xs"
            title="Unit the values on this row are written in"
          >
            {LENGTH_UNITS.map((u) => (
              <option key={u} value={u}>
                {UNIT_LABELS[u]}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => onMove(-1)} disabled={index === 0} className="rounded-lg p-1.5 text-stone-500 hover:bg-stone-100 disabled:opacity-30" aria-label="Move row up">
            <ArrowUp className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => onMove(1)} disabled={index === total - 1} className="rounded-lg p-1.5 text-stone-500 hover:bg-stone-100 disabled:opacity-30" aria-label="Move row down">
            <ArrowDown className="h-4 w-4" />
          </button>
          <button type="button" onClick={onRemove} className="rounded-lg p-1.5 text-stone-500 hover:bg-red-50 hover:text-red-700" aria-label="Delete row">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </header>

      {item.question && (
        <div className={cn("mb-3 rounded-xl border p-3 text-sm", item.confirmed ? "border-emerald-200 bg-emerald-50" : "border-amber-300 bg-amber-50")}>
          <p className="flex gap-2 text-stone-800">
            <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden />
            <span>{item.question}</span>
          </p>
          <label className="mt-2 flex cursor-pointer items-center gap-2 pl-6 text-xs font-medium text-stone-700">
            <input
              type="checkbox"
              checked={item.confirmed}
              onChange={(e) => onChange({ ...item, confirmed: e.target.checked })}
              className="h-4 w-4 accent-emerald-700"
            />
            I have checked this row and corrected it if needed
          </label>
        </div>
      )}

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        {DIMENSION_KEYS.filter((k) => config.columns[k]).map((k) => (
          <MeasurementField
            key={k}
            label={LABELS[k]}
            m={item[k]}
            required={config.requiredFields.includes(k)}
            onChange={(m) => onChange({ ...item, [k]: m })}
            onHover={(h) => onHover(h ? { itemId: item.id, field: k } : { itemId: item.id, field: null })}
          />
        ))}
      </div>

      {item.notes.length > 0 && (
        <ul className="mt-3 space-y-1">
          {item.notes.map((n, i) => (
            <li key={i} className="flex gap-1.5 text-xs text-stone-600">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {n}
            </li>
          ))}
        </ul>
      )}

      <footer className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-stone-100 pt-3 text-xs text-stone-600">
        <span className="font-semibold text-stone-500">In Excel:</span>
        {DIMENSION_KEYS.filter((k) => config.columns[k]).map((k) => (
          <span key={k}>
            {LABELS[k]} {tplVal(k) === null ? "—" : `${formatNumber(tplVal(k), config.decimals)} ${config.inputUnit}`}
          </span>
        ))}
        {computed
          .filter((c) => c.value !== null && c.value !== "")
          .map((c) => (
            <span key={c.column} className="text-stone-500" title={c.header}>
              {c.header.replace(/\s*\(auto\)|\s*auto/gi, "").replace(/\s+/g, " ")}:{" "}
              <b className="font-semibold text-stone-800">{typeof c.value === "number" ? formatNumber(c.value, 2) : String(c.value)}</b>
            </span>
          ))}
        {imageLabel && <span className="ml-auto text-stone-400">{imageLabel}</span>}
      </footer>

    </article>
  );
}
