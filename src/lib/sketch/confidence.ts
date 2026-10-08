/** Confidence tiers used throughout the review UI. */
export type ConfidenceTier = "high" | "medium" | "review";

export const HIGH_CONFIDENCE = 95;
export const MEDIUM_CONFIDENCE = 80;

export function confidenceTier(confidence: number): ConfidenceTier {
  if (confidence >= HIGH_CONFIDENCE) return "high";
  if (confidence >= MEDIUM_CONFIDENCE) return "medium";
  return "review";
}

export const TIER_LABEL: Record<ConfidenceTier, string> = {
  high: "High confidence",
  medium: "Medium confidence",
  review: "Needs review",
};

export function clampConfidence(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}
