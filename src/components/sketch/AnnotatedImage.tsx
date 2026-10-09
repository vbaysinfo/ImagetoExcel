"use client";

import type { DimensionKey, LineItem, OcrToken } from "@/lib/sketch/types";
import { DIMENSION_KEYS } from "@/lib/sketch/types";
import { formatNumber } from "@/lib/sketch/units";

export const ITEM_COLORS = ["#b45309", "#0f766e", "#7c3aed", "#be123c", "#1d4ed8", "#4d7c0f", "#a21caf", "#c2410c", "#0e7490", "#57534e"];

const LABEL: Record<DimensionKey, string> = { width: "W", height: "H", depth: "D" };

/**
 * Verification overlay: draws what the AI detected on top of the image that
 * was analysed — the region of each component and a labelled box around
 * each dimension it read ("W = 2800 mm").
 */
export function AnnotatedImage({
  src,
  width,
  height,
  items,
  tokens,
  colorOf,
  showOverlay,
  showTokens,
  highlight,
  onSelectItem,
  onPointClick,
  children,
}: {
  src: string;
  width: number;
  height: number;
  items: LineItem[];
  tokens: OcrToken[];
  colorOf: (itemId: string) => string;
  showOverlay: boolean;
  showTokens: boolean;
  highlight: { itemId: string; field: DimensionKey | null } | null;
  onSelectItem?: (itemId: string) => void;
  /** Tap-to-enter: called with the normalised point that was clicked. */
  onPointClick?: (p: { x: number; y: number }) => void;
  /** Extra content positioned over the image (e.g. the entry popover). */
  children?: React.ReactNode;
}) {
  const font = Math.max(12, Math.round(Math.max(width, height) / 70));
  const stroke = Math.max(1.5, Math.max(width, height) / 600);
  const usedTokenIds = new Set(items.flatMap((it) => DIMENSION_KEYS.flatMap((k) => it[k].tokenIds)));

  return (
    <div className="relative w-full">
      {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL */}
      <img
        src={src}
        alt="Drawing being analysed"
        className={`block h-auto w-full select-none ${onPointClick ? "cursor-crosshair" : ""}`}
        draggable={false}
        onClick={(e) => {
          if (!onPointClick) return;
          const r = e.currentTarget.getBoundingClientRect();
          onPointClick({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
        }}
      />
      {showOverlay && (
        <svg viewBox={`0 0 ${width} ${height}`} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
          {showTokens &&
            tokens
              .filter((t) => t.bbox && (t.kind === "number" || t.kind === "expression") && !usedTokenIds.has(t.id))
              .map((t) => (
                <rect
                  key={t.id}
                  x={t.bbox!.x * width}
                  y={t.bbox!.y * height}
                  width={t.bbox!.w * width}
                  height={t.bbox!.h * height}
                  fill="none"
                  stroke="#dc2626"
                  strokeWidth={stroke}
                  strokeDasharray={`${stroke * 3} ${stroke * 2}`}
                >
                  <title>{`Unused number "${t.text}"`}</title>
                </rect>
              ))}
          {items.map((it) => {
            const color = colorOf(it.id);
            const active = highlight?.itemId === it.id;
            const dim = highlight && !active ? 0.25 : 1;
            return (
              <g key={it.id} opacity={dim} onClick={() => onSelectItem?.(it.id)} style={{ cursor: onSelectItem ? "pointer" : undefined, pointerEvents: onPointClick ? "none" : "auto" }}>
                {it.region && (
                  <rect
                    x={it.region.x * width}
                    y={it.region.y * height}
                    width={it.region.w * width}
                    height={it.region.h * height}
                    fill={color}
                    fillOpacity={active ? 0.12 : 0.05}
                    stroke={color}
                    strokeWidth={stroke * (active ? 1.6 : 1)}
                    strokeDasharray={`${stroke * 6} ${stroke * 3}`}
                  >
                    <title>{it.item || "Component"}</title>
                  </rect>
                )}
                {DIMENSION_KEYS.map((k) => {
                  const m = it[k];
                  if (!m.bbox || m.value === null) return null;
                  const x = m.bbox.x * width;
                  const y = m.bbox.y * height;
                  const w = m.bbox.w * width;
                  const h = m.bbox.h * height;
                  const focused = active && (highlight?.field === k || highlight?.field === null);
                  const label = `${LABEL[k]} = ${formatNumber(m.value, 3)} ${m.unit}`;
                  const ly = y > font * 1.6 ? y - font * 0.4 : y + h + font * 1.1;
                  return (
                    <g key={k}>
                      <rect x={x - stroke} y={y - stroke} width={w + stroke * 2} height={h + stroke * 2} fill="none" stroke={m.needsReview ? "#dc2626" : color} strokeWidth={stroke * (focused ? 2.2 : 1.3)} rx={stroke * 2} />
                      <text
                        x={x}
                        y={ly}
                        fontSize={font}
                        fontWeight={700}
                        fill={m.needsReview ? "#dc2626" : color}
                        stroke="#fff"
                        strokeWidth={font / 4}
                        paintOrder="stroke"
                        style={{ fontFamily: "system-ui, sans-serif" }}
                      >
                        {label}
                      </text>
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      )}
      {children}
    </div>
  );
}
