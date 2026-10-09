"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DimensionKey, LengthUnit, LineItem } from "@/lib/sketch/types";
import { LENGTH_UNITS } from "@/lib/sketch/types";
import { UNIT_LABELS } from "@/lib/sketch/units";

export interface TapTarget {
  /** null = start a new row. */
  itemId: string | null;
  field: DimensionKey;
}

const FIELD_LABEL: Record<DimensionKey, string> = { width: "Width", height: "Height", depth: "Depth" };

/**
 * Small popover shown where the user tapped the drawing: pick the row and
 * field, type the number written there, press Enter.
 */
export function TapEntry({
  point,
  rows,
  target,
  fields,
  defaultUnit,
  onSave,
  onClose,
}: {
  point: { x: number; y: number };
  rows: { item: LineItem; index: number }[];
  target: TapTarget;
  fields: DimensionKey[];
  defaultUnit: LengthUnit;
  onSave: (t: TapTarget, value: number, unit: LengthUnit) => void;
  onClose: () => void;
}) {
  const [itemId, setItemId] = useState<string | null>(target.itemId);
  const [field, setField] = useState<DimensionKey>(target.field);
  const [text, setText] = useState("");
  const [newUnit, setNewUnit] = useState<LengthUnit>(defaultUnit);
  const row = rows.find((r) => r.item.id === itemId)?.item ?? null;
  const unit = row ? row.width.unit : newUnit;
  const value = Number(text.trim().replace(",", "."));
  const valid = text.trim() !== "" && Number.isFinite(value) && value > 0;

  const save = () => {
    if (valid) onSave({ itemId, field }, value, unit);
  };

  return (
    <div
      className="absolute z-20 w-64 rounded-2xl border border-stone-200 bg-white p-3 text-sm text-stone-900 shadow-xl"
      style={{
        left: `${Math.min(Math.max(point.x * 100, 2), 98)}%`,
        top: `${point.y * 100}%`,
        transform: `translate(${point.x > 0.6 ? "-100%" : point.x < 0.3 ? "0" : "-50%"}, ${point.y > 0.65 ? "calc(-100% - 12px)" : "12px"})`,
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      role="dialog"
      aria-label="Enter the measurement written here"
    >
      <div className="mb-2 flex items-center gap-2">
        <select
          value={itemId ?? ""}
          onChange={(e) => setItemId(e.target.value || null)}
          className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-2 py-1 text-xs"
          aria-label="Row"
        >
          {rows.map(({ item, index }) => (
            <option key={item.id} value={item.id}>
              Row {index + 1}: {item.item || "(no name)"}
            </option>
          ))}
          <option value="">＋ New row</option>
        </select>
        <button type="button" onClick={onClose} className="rounded-lg p-1 text-stone-500 hover:bg-stone-100" aria-label="Cancel">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mb-2 flex gap-1">
        {fields.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setField(f)}
            className={cn("flex-1 rounded-lg px-2 py-1 text-xs font-semibold", field === f ? "bg-amber-600 text-white" : "bg-stone-100 text-stone-700 hover:bg-stone-200")}
          >
            {FIELD_LABEL[f]}
          </button>
        ))}
      </div>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <input
          autoFocus
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. 2800"
          aria-label={`${FIELD_LABEL[field]} value`}
          className="w-full min-w-0 rounded-lg border border-stone-300 px-2.5 py-1.5 text-base tabular-nums outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20"
        />
        {row ? (
          <span className="text-xs text-stone-500">{UNIT_LABELS[unit]}</span>
        ) : (
          <select value={newUnit} onChange={(e) => setNewUnit(e.target.value as LengthUnit)} className="rounded-lg border border-stone-300 bg-white px-1 py-1.5 text-xs" aria-label="Unit">
            {LENGTH_UNITS.map((u) => (
              <option key={u} value={u}>
                {UNIT_LABELS[u]}
              </option>
            ))}
          </select>
        )}
        <button type="submit" disabled={!valid} className="rounded-lg bg-stone-900 p-2 text-white disabled:opacity-40" aria-label="Save">
          <Check className="h-4 w-4" />
        </button>
      </form>
      <p className="mt-1.5 text-[11px] text-stone-500">Enter saves and moves to the next field.</p>
    </div>
  );
}
