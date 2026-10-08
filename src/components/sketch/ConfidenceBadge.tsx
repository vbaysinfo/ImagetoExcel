import { cn } from "@/lib/utils";
import { confidenceTier } from "@/lib/sketch/confidence";
import type { Measurement } from "@/lib/sketch/types";

export const TIER_STYLES = {
  high: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  medium: "bg-amber-50 text-amber-800 ring-amber-200",
  review: "bg-red-50 text-red-700 ring-red-200",
  manual: "bg-sky-50 text-sky-800 ring-sky-200",
  none: "bg-stone-100 text-stone-500 ring-stone-200",
};

export function ConfidenceBadge({ m, className }: { m: Measurement; className?: string }) {
  let style: keyof typeof TIER_STYLES;
  let label: string;
  if (m.source === "manual") {
    style = "manual";
    label = "Entered";
  } else if (m.value === null) {
    style = m.needsReview ? "review" : "none";
    label = m.verified ? "None" : m.needsReview ? "Missing" : "Not used";
  } else if (m.verified) {
    style = "manual";
    label = "Verified";
  } else {
    const tier = confidenceTier(m.confidence);
    style = m.needsReview ? "review" : tier;
    label = `${m.confidence}%`;
  }
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ring-1 ring-inset",
        TIER_STYLES[style],
        className,
      )}
      title={
        m.source === "manual"
          ? "Entered or corrected by you"
          : m.value === null
            ? "No value found on the drawing"
            : `Confidence ${m.confidence}% — ≥95% high, 80–94% medium, below 80% needs review`
      }
    >
      {label}
    </span>
  );
}
