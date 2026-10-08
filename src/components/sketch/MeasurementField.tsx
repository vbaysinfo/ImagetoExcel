"use client";

import { useState } from "react";
import { AlertTriangle, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Measurement } from "@/lib/sketch/types";
import { confirmMeasurement, manualMeasurement } from "@/lib/sketch/review";
import { formatNumber } from "@/lib/sketch/units";
import { ConfidenceBadge } from "./ConfidenceBadge";

function sourceText(m: Measurement): string | null {
  if (m.source === "manual") return "Entered by you";
  if (m.source === "derived" && m.rawText) return `Calculated on drawing: ${m.rawText}`;
  if (m.source === "detected" && m.rawText) return `Read from drawing: “${m.rawText}”`;
  return null;
}

export function MeasurementField({
  label,
  m,
  required,
  onChange,
  onHover,
}: {
  label: string;
  m: Measurement;
  required: boolean;
  onChange: (m: Measurement) => void;
  onHover?: (hovering: boolean) => void;
}) {
  const [text, setText] = useState(m.value === null ? "" : String(m.value));
  const [synced, setSynced] = useState(m.value);
  // Follow external changes (alternative picked, unit change, re-analysis).
  if (synced !== m.value) {
    setSynced(m.value);
    setText(m.value === null ? "" : String(m.value));
  }

  const commit = (raw: string) => {
    const t = raw.trim().replace(",", ".");
    if (t === "") {
      if (m.value !== null) onChange(manualMeasurement(m, null));
      return;
    }
    const n = Number(t);
    if (!Number.isFinite(n) || n <= 0) {
      setText(m.value === null ? "" : String(m.value));
      return;
    }
    if (n !== m.value || m.source !== "manual") onChange(manualMeasurement(m, n));
  };

  const attention = m.needsReview || (required && m.value === null);
  const source = sourceText(m);

  return (
    <div
      className={cn(
        "rounded-xl border p-3 transition-colors",
        attention ? "border-red-300 bg-red-50/40" : "border-stone-200 bg-white",
      )}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label className="text-xs font-semibold uppercase tracking-wide text-stone-600">
          {label}
          {required ? <span className="text-red-600"> *</span> : <span className="font-normal normal-case text-stone-400"> (optional)</span>}
        </label>
        <ConfidenceBadge m={m} />
      </div>
      <div className="flex items-center gap-2">
        <input
          inputMode="decimal"
          className="w-full min-w-0 rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-base tabular-nums text-stone-900 outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20"
          value={text}
          placeholder={required ? "Enter value" : "—"}
          aria-label={`${label} in ${m.unit}`}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
        <span className="shrink-0 text-sm text-stone-500">{m.unit}</span>
      </div>
      {source && <p className="mt-1.5 truncate text-[11px] text-stone-500" title={source}>{source}</p>}

      {m.issues.length > 0 && (
        <ul className="mt-2 space-y-1">
          {m.issues.map((issue, i) => (
            <li key={i} className="flex gap-1.5 text-xs leading-snug text-red-700">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>{issue}</span>
            </li>
          ))}
        </ul>
      )}

      {(m.alternatives.length > 0 || (m.needsReview && m.value !== null) || (m.needsReview && !required && m.value === null)) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {m.alternatives.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => onChange(manualMeasurement(m, a))}
              className="rounded-full border border-stone-300 bg-white px-2.5 py-1 text-xs text-stone-700 hover:border-amber-600 hover:text-amber-800"
            >
              Use {formatNumber(a, 3)}
            </button>
          ))}
          {m.needsReview && m.value !== null && (
            <button
              type="button"
              onClick={() => onChange(confirmMeasurement(m))}
              className="inline-flex items-center gap-1 rounded-full bg-emerald-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-800"
            >
              <Check className="h-3.5 w-3.5" aria-hidden /> {formatNumber(m.value, 3)} is correct
            </button>
          )}
          {m.needsReview && !required && m.value === null && (
            <button
              type="button"
              onClick={() => onChange(confirmMeasurement(m))}
              className="inline-flex items-center gap-1 rounded-full border border-stone-300 bg-white px-2.5 py-1 text-xs text-stone-700 hover:border-emerald-700"
            >
              <Check className="h-3.5 w-3.5" aria-hidden /> Leave blank
            </button>
          )}
        </div>
      )}
    </div>
  );
}
