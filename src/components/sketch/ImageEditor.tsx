"use client";

import { useMemo, useRef, useState } from "react";
import { Crop, Eye, Minus, Plus, RotateCcw, RotateCw, ScanLine, Sparkles, Undo2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DEFAULT_ENHANCE,
  FULL_QUAD,
  detectPaper,
  downscale,
  rotate,
  type EnhanceOptions,
  type Quad,
} from "@/lib/sketch/image/ops";

export interface EditSettings {
  rotation: number;
  fineAngle: number;
  quad: Quad;
  enhance: EnhanceOptions;
}

const ENHANCE_LABELS: { key: keyof EnhanceOptions; label: string; hint: string }[] = [
  { key: "cleanBackground", label: "Remove shadows", hint: "Evens out lighting and turns the paper white" },
  { key: "contrast", label: "Improve contrast", hint: "Makes ink darker against the paper" },
  { key: "boostFaint", label: "Boost faint lines", hint: "Helps with light pencil or faded pen" },
  { key: "sharpen", label: "Sharpen", hint: "Crisper edges on handwriting" },
  { key: "grayscale", label: "Grayscale", hint: "Removes colour" },
];

export function ImageEditor({
  name,
  original,
  originalUrl,
  processedUrl,
  processing,
  settings,
  onChange,
  onClose,
}: {
  name: string;
  original: HTMLCanvasElement;
  originalUrl: string;
  processedUrl: string | null;
  processing: boolean;
  settings: EditSettings;
  onChange: (s: EditSettings) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"crop" | "clean">("crop");
  const [zoom, setZoom] = useState(1);
  const [showOriginal, setShowOriginal] = useState(false);
  const [quad, setQuad] = useState<Quad>(settings.quad);
  const [notice, setNotice] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragging = useRef<number | null>(null);

  const rotated = useMemo(
    () => downscale(rotate(downscale(original, 1600), settings.rotation + settings.fineAngle), 1400),
    [original, settings.rotation, settings.fineAngle],
  );
  const rotatedUrl = useMemo(() => rotated.toDataURL("image/jpeg", 0.85), [rotated]);

  const update = (patch: Partial<EditSettings>) => onChange({ ...settings, ...patch });

  const turn = (deg: number) => {
    setQuad(FULL_QUAD);
    update({ rotation: (settings.rotation + deg + 360) % 360, quad: FULL_QUAD });
  };

  const pointerPos = (e: React.PointerEvent) => {
    const r = imgRef.current?.getBoundingClientRect();
    if (!r) return null;
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (dragging.current === null) return;
    const p = pointerPos(e);
    if (!p) return;
    const next = quad.map((q, i) => (i === dragging.current ? p : q)) as Quad;
    setQuad(next);
  };
  const endDrag = () => {
    if (dragging.current === null) return;
    dragging.current = null;
    update({ quad });
  };

  const autoDetect = () => {
    const found = detectPaper(rotated);
    if (found) {
      setQuad(found);
      update({ quad: found });
      setNotice("Paper edges detected — drag the corners to fine-tune.");
    } else {
      setNotice("Couldn't find clear paper edges. Drag the corners to the drawing's corners instead.");
    }
  };

  const w = rotated.width;
  const h = rotated.height;
  const handle = Math.max(w, h) / 45;
  const editingCrop = tab === "crop";

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-stone-900 text-white" role="dialog" aria-modal aria-label={`Prepare ${name}`}>
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2 sm:px-5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{name}</p>
          <p className="text-xs text-white/60">Straighten, crop and clean the photo before analysis. The original is kept.</p>
        </div>
        <button type="button" onClick={onClose} className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold hover:bg-amber-500">
          Done
        </button>
        <button type="button" onClick={onClose} className="rounded-lg p-2 hover:bg-white/10" aria-label="Close">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-b border-white/10 px-3 py-2 text-sm sm:px-5">
        <div className="mr-2 inline-flex rounded-lg bg-white/10 p-0.5">
          <button type="button" onClick={() => setTab("crop")} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5", tab === "crop" && "bg-white text-stone-900")}>
            <Crop className="h-4 w-4" /> Crop &amp; straighten
          </button>
          <button type="button" onClick={() => setTab("clean")} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5", tab === "clean" && "bg-white text-stone-900")}>
            <Sparkles className="h-4 w-4" /> Clean up
          </button>
        </div>
        <button type="button" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} className="rounded-lg p-2 hover:bg-white/10" aria-label="Zoom out">
          <Minus className="h-4 w-4" />
        </button>
        <span className="w-12 text-center tabular-nums text-white/70">{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => setZoom((z) => Math.min(4, z + 0.25))} className="rounded-lg p-2 hover:bg-white/10" aria-label="Zoom in">
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-6" onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
          <div className="mx-auto" style={{ width: `${zoom * 100}%`, maxWidth: zoom === 1 ? 900 : undefined }}>
            {editingCrop ? (
              <div className="relative touch-none select-none">
                {/* eslint-disable-next-line @next/next/no-img-element -- local data URL */}
                <img ref={imgRef} src={rotatedUrl} alt="" className="block h-auto w-full" draggable={false} />
                <svg viewBox={`0 0 ${w} ${h}`} className="absolute inset-0 h-full w-full">
                  <path
                    d={`M0 0H${w}V${h}H0Z M${quad.map((p) => `${p.x * w} ${p.y * h}`).join(" L")}Z`}
                    fill="rgba(0,0,0,0.45)"
                    fillRule="evenodd"
                  />
                  <polygon points={quad.map((p) => `${p.x * w},${p.y * h}`).join(" ")} fill="none" stroke="#f59e0b" strokeWidth={handle / 6} />
                  {quad.map((p, i) => (
                    <circle
                      key={i}
                      cx={p.x * w}
                      cy={p.y * h}
                      r={handle}
                      fill="rgba(245,158,11,0.35)"
                      stroke="#f59e0b"
                      strokeWidth={handle / 5}
                      style={{ cursor: "grab" }}
                      onPointerDown={(e) => {
                        (e.target as Element).setPointerCapture?.(e.pointerId);
                        dragging.current = i;
                      }}
                      onPointerMove={onPointerMove}
                      onPointerUp={endDrag}
                    />
                  ))}
                </svg>
              </div>
            ) : (
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL */}
                <img src={showOriginal || !processedUrl ? originalUrl : processedUrl} alt="" className={cn("block h-auto w-full bg-white", processing && "opacity-60")} />
                {processing && <p className="absolute left-3 top-3 rounded bg-black/70 px-2 py-1 text-xs">Processing…</p>}
                {showOriginal && <p className="absolute left-3 top-3 rounded bg-black/70 px-2 py-1 text-xs">Original</p>}
              </div>
            )}
          </div>
        </div>

        <aside className="w-full shrink-0 space-y-4 overflow-y-auto border-t border-white/10 p-4 text-sm lg:w-80 lg:border-l lg:border-t-0">
          {editingCrop ? (
            <>
              <div>
                <p className="mb-2 font-semibold">Rotate</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => turn(-90)} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 hover:bg-white/20">
                    <RotateCcw className="h-4 w-4" /> Left
                  </button>
                  <button type="button" onClick={() => turn(90)} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 hover:bg-white/20">
                    <RotateCw className="h-4 w-4" /> Right
                  </button>
                </div>
              </div>
              <div>
                <label className="mb-2 flex justify-between font-semibold">
                  Straighten <span className="font-normal tabular-nums text-white/60">{settings.fineAngle.toFixed(1)}°</span>
                </label>
                <input
                  type="range"
                  min={-15}
                  max={15}
                  step={0.5}
                  value={settings.fineAngle}
                  onChange={(e) => {
                    setQuad(FULL_QUAD);
                    update({ fineAngle: Number(e.target.value), quad: FULL_QUAD });
                  }}
                  className="w-full accent-amber-500"
                />
              </div>
              <div>
                <p className="mb-2 font-semibold">Crop &amp; fix perspective</p>
                <p className="mb-2 text-xs text-white/60">Drag the four corners onto the corners of the drawing. The image is flattened as if photographed straight on.</p>
                <div className="flex gap-2">
                  <button type="button" onClick={autoDetect} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 hover:bg-white/20">
                    <ScanLine className="h-4 w-4" /> Detect paper
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setQuad(FULL_QUAD);
                      update({ quad: FULL_QUAD });
                      setNotice(null);
                    }}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 hover:bg-white/20"
                  >
                    <Undo2 className="h-4 w-4" /> Reset
                  </button>
                </div>
                {notice && <p className="mt-2 text-xs text-amber-300">{notice}</p>}
              </div>
            </>
          ) : (
            <>
              <div className="space-y-2">
                {ENHANCE_LABELS.map(({ key, label, hint }) => (
                  <label key={key} className="flex cursor-pointer items-start gap-3 rounded-lg bg-white/5 p-2.5 hover:bg-white/10">
                    <input
                      type="checkbox"
                      checked={settings.enhance[key]}
                      onChange={(e) => update({ enhance: { ...settings.enhance, [key]: e.target.checked } })}
                      className="mt-0.5 h-4 w-4 accent-amber-500"
                    />
                    <span>
                      <span className="block font-medium">{label}</span>
                      <span className="block text-xs text-white/60">{hint}</span>
                    </span>
                  </label>
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowOriginal((v) => !v)}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 hover:bg-white/20"
                >
                  <Eye className="h-4 w-4" /> {showOriginal ? "Show cleaned" : "Compare original"}
                </button>
                <button
                  type="button"
                  onClick={() => update({ enhance: DEFAULT_ENHANCE })}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 hover:bg-white/20"
                >
                  <Undo2 className="h-4 w-4" /> Defaults
                </button>
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
