"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  ImagePlus,
  Layers,
  Loader2,
  Plus,
  ScanSearch,
  Settings2,
  SlidersHorizontal,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DEFAULT_ENHANCE,
  FULL_QUAD,
  canvasToBlob,
  detectPaper,
  downscale,
  enhance,
  rotate,
  sharpness,
  warpQuad,
} from "@/lib/sketch/image/ops";
import { ACCEPT_ATTR, isExcel, loadFile } from "@/lib/sketch/image/load";
import {
  ApiError,
  analyzeImage,
  fetchToolInfo,
  generateExcel,
  getAccessCode,
  importExcel,
  saveBlob,
  setStored,
  type ToolInfo,
} from "@/lib/sketch/client/api";
import { findBlockers, newManualItem, toGenerateRows } from "@/lib/sketch/review";
import type { AnalysisResult, DimensionKey, LengthUnit, LineItem } from "@/lib/sketch/types";
import { LENGTH_UNITS } from "@/lib/sketch/types";
import { UNIT_LABELS } from "@/lib/sketch/units";
import { ImageEditor, type EditSettings } from "./ImageEditor";
import { AnnotatedImage, ITEM_COLORS } from "./AnnotatedImage";
import { ItemCard } from "./ItemCard";
import { ExcelPreview } from "./ExcelPreview";

/** Longest edge sent to the vision model. */
const ANALYSIS_EDGE = 1568;
const BLUR_THRESHOLD = 25;

interface SketchImage {
  id: string;
  seq: number;
  name: string;
  original: HTMLCanvasElement;
  originalUrl: string;
  settings: EditSettings;
  processed: HTMLCanvasElement | null;
  processedUrl: string | null;
  processing: boolean;
  qualityWarnings: string[];
  hints: string;
  status: "idle" | "analyzing" | "done" | "error";
  error: string | null;
  analysis: AnalysisResult | null;
  startedAt: number | null;
  /** Uploaded in automatic mode: analyse as soon as the image is prepared. */
  auto: boolean;
}

let seqCounter = 0;

/** original → rotate → crop/perspective → downscale → clean up. */
function processCanvas(img: SketchImage): { prepared: HTMLCanvasElement; output: HTMLCanvasElement } {
  const { rotation, fineAngle, quad, enhance: opts } = img.settings;
  const prepared = downscale(warpQuad(rotate(img.original, rotation + fineAngle), quad), ANALYSIS_EDGE);
  return { prepared, output: enhance(prepared, opts) };
}

function Step({ n, title, done, children, id }: { n: number; title: string; done?: boolean; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="min-w-0 scroll-mt-20 rounded-3xl border border-stone-200 bg-white/70 p-4 shadow-sm backdrop-blur sm:p-6">
      <h2 className="mb-4 flex items-center gap-3 text-lg font-semibold text-stone-900">
        <span className={cn("inline-flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold", done ? "bg-emerald-600 text-white" : "bg-stone-900 text-white")}>
          {done ? <CheckCircle2 className="h-4 w-4" /> : n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export function SketchToExcelApp() {
  const [info, setInfo] = useState<ToolInfo | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [images, setImages] = useState<SketchImage[]>([]);
  const [items, setItems] = useState<LineItem[]>([]);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [showOverlay, setShowOverlay] = useState(true);
  const [showUnused, setShowUnused] = useState(true);
  const [highlight, setHighlight] = useState<{ itemId: string; field: DimensionKey | null } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [lastFile, setLastFile] = useState<{ blob: Blob; fileName: string; rows: number; draft: boolean; checks: number } | null>(null);
  /** Rows changed since the last download. */
  const [dirty, setDirty] = useState(false);
  const [autoMode, setAutoMode] = useState(true);
  const [autoExportPending, setAutoExportPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [accessCode, setAccessCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  const loadInfo = useCallback(() => {
    fetchToolInfo()
      .then((i) => {
        setInfo(i);
        setInfoError(null);
        setNeedsCode(i.accessCodeRequired && !getAccessCode());
      })
      .catch((e: unknown) => setInfoError(e instanceof Error ? e.message : "Could not load the Excel template."));
  }, []);
  useEffect(loadInfo, [loadInfo]);

  // Tick for the "analysing… 34s" timers.
  const anyAnalyzing = images.some((i) => i.status === "analyzing");
  useEffect(() => {
    if (!anyAnalyzing) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [anyAnalyzing]);

  const patchImage = useCallback((id: string, patch: Partial<SketchImage> | ((img: SketchImage) => Partial<SketchImage>)) => {
    setImages((list) => list.map((img) => (img.id === id ? { ...img, ...(typeof patch === "function" ? patch(img) : patch) } : img)));
  }, []);

  /* --------------------------- Image processing --------------------------- */

  const settingsKey = images.map((i) => `${i.id}:${JSON.stringify(i.settings)}`).join("|");
  const processedFor = useRef(new Map<string, string>());
  useEffect(() => {
    const pending = images.filter((img) => processedFor.current.get(img.id) !== JSON.stringify(img.settings));
    if (!pending.length) return;
    const timer = setTimeout(async () => {
      for (const img of pending) {
        const key = JSON.stringify(img.settings);
        processedFor.current.set(img.id, key);
        patchImage(img.id, { processing: true });
        await new Promise((r) => setTimeout(r, 0));
        try {
          const { prepared, output: canvas } = processCanvas(img);
          const blob = await canvasToBlob(canvas, "image/jpeg", 0.88);
          const url = URL.createObjectURL(blob);
          const warnings: string[] = [];
          const sharp = sharpness(prepared);
          if (sharp < BLUR_THRESHOLD) warnings.push("The photo looks blurry; handwriting may be misread.");
          if (Math.max(img.original.width, img.original.height) < 800) warnings.push("The image resolution is low; small numbers may be misread.");
          patchImage(img.id, (cur) => {
            if (cur.processedUrl) URL.revokeObjectURL(cur.processedUrl);
            return { processed: canvas, processedUrl: url, processing: false, qualityWarnings: warnings };
          });
        } catch (e) {
          patchImage(img.id, { processing: false, error: e instanceof Error ? e.message : "Image processing failed." });
        }
      }
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run only when settings change
  }, [settingsKey]);

  /* ------------------------------- Upload -------------------------------- */

  const autoRef = useRef(autoMode);
  useEffect(() => {
    autoRef.current = autoMode;
  }, [autoMode]);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const errors: string[] = [];
    const added: SketchImage[] = [];
    for (const file of Array.from(files)) {
      if (isExcel(file)) {
        try {
          const { items: imported } = await importExcel(file);
          setItems((list) => [...list, ...imported]);
          setDirty(true);
          setNotice(`Loaded ${imported.length} rows from "${file.name}". Edit them below, then download the updated Excel.`);
        } catch (e) {
          errors.push(e instanceof Error ? e.message : `"${file.name}" could not be read.`);
        }
        continue;
      }
      try {
        for (const page of await loadFile(file)) {
          const blob = await canvasToBlob(downscale(page.canvas, 1600), "image/jpeg", 0.85);
          // Crop to the sheet of paper automatically when its edges are clear.
          const paper = detectPaper(downscale(page.canvas, 1600));
          added.push({
            id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
            seq: ++seqCounter,
            name: page.name,
            original: page.canvas,
            originalUrl: URL.createObjectURL(blob),
            settings: { rotation: 0, fineAngle: 0, quad: paper ?? FULL_QUAD, enhance: DEFAULT_ENHANCE },
            processed: null,
            processedUrl: null,
            processing: true,
            qualityWarnings: [],
            hints: "",
            status: "idle",
            error: null,
            analysis: null,
            startedAt: null,
            auto: autoRef.current,
          });
        }
      } catch (e) {
        errors.push(e instanceof Error ? e.message : `"${file.name}" could not be loaded.`);
      }
    }
    setUploadErrors(errors);
    if (added.length) {
      setImages((list) => [...list, ...added]);
      setSelectedImageId((cur) => cur ?? added[0].id);
      if (autoRef.current) {
        setAutoExportPending(true);
        setNotice(null);
      }
    }
  }, []);

  const removeImage = (id: string) => {
    const img = images.find((i) => i.id === id);
    if (img) {
      URL.revokeObjectURL(img.originalUrl);
      if (img.processedUrl) URL.revokeObjectURL(img.processedUrl);
      setItems((list) => list.filter((it) => it.imageIndex !== img.seq));
    }
    processedFor.current.delete(id);
    setImages((list) => list.filter((i) => i.id !== id));
    if (selectedImageId === id) setSelectedImageId(images.find((i) => i.id !== id)?.id ?? null);
  };

  /* ------------------------------ Analysis ------------------------------- */

  const analyze = async (img: SketchImage) => {
    if (!img.processed) return;
    patchImage(img.id, { status: "analyzing", error: null, startedAt: Date.now(), auto: false });
    try {
      const blob = await canvasToBlob(img.processed, "image/jpeg", 0.9);
      const result = await analyzeImage({
        blob,
        width: img.processed.width,
        height: img.processed.height,
        imageIndex: img.seq,
        hints: img.hints,
        qualityWarnings: img.qualityWarnings,
      });
      patchImage(img.id, { status: "done", analysis: result });
      // Replace this image's AI rows, keep rows the user added by hand.
      setItems((list) => {
        const kept = list.filter((it) => it.imageIndex !== img.seq || it.id.startsWith("manual"));
        const insertAt = kept.findIndex((it) => it.imageIndex > img.seq);
        const next = [...kept];
        next.splice(insertAt === -1 ? next.length : insertAt, 0, ...result.items);
        return next;
      });
      setSelectedImageId(img.id);
      setDirty(true);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Analysis failed.";
      if (e instanceof ApiError && e.code === "ACCESS_DENIED") setNeedsCode(true);
      patchImage(img.id, { status: "error", error: message });
    }
  };

  const analyzeAll = async () => {
    for (const img of images.filter((i) => i.status !== "analyzing" && i.status !== "done")) await analyze(img);
  };

  /* ------------------------------- Review -------------------------------- */

  const profile = info?.profile ?? null;
  const blockers = useMemo(() => (profile ? findBlockers(items, profile.config) : []), [items, profile]);
  const colorOf = useCallback((id: string) => ITEM_COLORS[Math.max(0, items.findIndex((i) => i.id === id)) % ITEM_COLORS.length], [items]);

  const updateItem = (next: LineItem) => {
    setItems((list) => list.map((it) => (it.id === next.id ? next : it)));
    setDirty(true);
  };
  const removeItem = (id: string) => {
    setItems((list) => list.filter((it) => it.id !== id));
    setDirty(true);
  };
  const moveItem = (id: string, dir: -1 | 1) => {
    setItems((list) => {
      const i = list.findIndex((it) => it.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };
  const addManualRow = () => {
    const selected = images.find((i) => i.id === selectedImageId);
    const last = items[items.length - 1];
    const unit: LengthUnit = selected?.analysis?.drawingUnit ?? last?.width.unit ?? "mm";
    const row = newManualItem(selected?.seq ?? last?.imageIndex ?? 0, unit, last?.room ?? "");
    setItems((list) => [...list, row]);
    setTimeout(() => document.getElementById(`row-${row.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  };
  const setImageUnit = (seq: number, unit: LengthUnit) => {
    setItems((list) =>
      list.map((it) =>
        it.imageIndex === seq
          ? { ...it, width: { ...it.width, unit }, height: { ...it.height, unit }, depth: { ...it.depth, unit } }
          : it,
      ),
    );
    setImages((list) => list.map((img) => (img.seq === seq && img.analysis ? { ...img, analysis: { ...img.analysis, drawingUnit: unit, unitSource: "explicit" } } : img)));
  };

  /**
   * Generate and download. With open checks the file is a draft: doubtful
   * values are written with a "⚠ CHECK" note in Remarks and values that were
   * not found stay blank — nothing is invented.
   */
  const generate = async (source: "auto" | "user" = "user") => {
    if (!profile || !items.length) return;
    const draft = blockers.length > 0;
    setGenerating(true);
    setGenerateError(null);
    try {
      const rows = toGenerateRows(items, profile.config, { markChecks: draft });
      const result = await generateExcel(rows, draft);
      const fileName = draft ? result.fileName.replace(/\.xlsx$/, "_draft.xlsx") : result.fileName;
      setLastFile({ blob: result.blob, fileName, rows: items.length, draft, checks: blockers.length });
      setDirty(false);
      saveBlob(result.blob, fileName);
      if (source === "auto") {
        setNotice(
          draft
            ? `Excel downloaded automatically as a draft: ${blockers.length} value(s) are marked “⚠ CHECK” in Remarks. Correct them below and download again.`
            : "Excel downloaded automatically. You can still edit any value below and download again.",
        );
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === "ACCESS_DENIED") setNeedsCode(true);
      setGenerateError(e instanceof Error ? e.message : "The Excel file could not be generated.");
    } finally {
      setGenerating(false);
    }
  };

  /* ----------------------------- Automatic mode ---------------------------- */

  const canAnalyze = info !== null && info.aiMode !== "none" && !needsCode;
  // Analyse automatically uploaded images one at a time, once they are prepared.
  const nextAuto = images.find((i) => i.auto && i.processed && !i.processing && i.status === "idle");
  useEffect(() => {
    if (!nextAuto || anyAnalyzing || !canAnalyze) return;
    const t = setTimeout(() => analyze(nextAuto), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- trigger on queue changes only
  }, [nextAuto?.id, anyAnalyzing, canAnalyze]);

  // When the whole batch is analysed, generate and download the Excel file.
  const autoBusy = images.some((i) => i.status === "analyzing" || (i.auto && i.status === "idle" && canAnalyze));
  useEffect(() => {
    if (!autoExportPending || autoBusy || !info) return;
    const t = setTimeout(() => {
      setAutoExportPending(false);
      if (items.length) generate("auto");
      else if (!canAnalyze) setNotice("Automatic analysis is not available on this server — enter the rows below and download the Excel file.");
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run when the batch completes
  }, [autoExportPending, autoBusy, info]);

  const selected = images.find((i) => i.id === selectedImageId) ?? null;
  const editing = images.find((i) => i.id === editingId) ?? null;
  const selectedItems = selected ? items.filter((it) => it.imageIndex === selected.seq) : [];
  const anyDemo = images.some((i) => i.analysis?.demo);
  const imageLabel = (seq: number) => {
    if (images.length < 2) return null;
    const idx = images.findIndex((i) => i.seq === seq);
    return idx >= 0 ? `Image ${idx + 1}` : null;
  };
  const roomOptions = Array.from(new Set([...items.map((i) => i.room), ...(profile?.exampleRows.map((r) => r.room) ?? [])].filter(Boolean)));
  const itemOptions = Array.from(new Set([...(profile?.exampleRows.map((r) => r.item) ?? [])].filter(Boolean)));
  const reviewCount = blockers.filter((b) => b.itemId).length;

  /* -------------------------------- Render -------------------------------- */

  return (
    <div className="min-h-screen bg-[#f5f3ef] text-stone-900">
      <header className="sticky top-0 z-40 border-b border-stone-200 bg-[#f5f3ef]/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-stone-900 text-amber-400">
            <FileSpreadsheet className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold sm:text-lg">Sketch / Image to Excel</h1>
            <p className="truncate text-xs text-stone-500">
              {profile ? `Template: ${profile.config.name} · ${profile.config.sheet}` : "Loading template…"}
            </p>
          </div>
          <Link href="/admin" className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm text-stone-600 hover:bg-stone-200/60">
            <Settings2 className="h-4 w-4" /> <span className="hidden sm:inline">Template setup</span>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-5 px-4 py-5 sm:px-6 sm:py-8">
        {infoError && (
          <Banner tone="error" title="The Excel template could not be loaded">
            {infoError}{" "}
            <button type="button" className="underline" onClick={loadInfo}>
              Retry
            </button>
          </Banner>
        )}
        {needsCode && (
          <Banner tone="warn" title="Access code required">
            <form
              className="mt-2 flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                setStored("access", accessCode.trim());
                setNeedsCode(false);
              }}
            >
              <input
                type="password"
                value={accessCode}
                onChange={(e) => setAccessCode(e.target.value)}
                placeholder="Enter the access code"
                className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm"
              />
              <button className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm font-medium text-white">Save</button>
            </form>
          </Banner>
        )}
        {info?.aiMode === "none" && (
          <Banner tone="warn" title="AI analysis is not configured on this server">
            Automatic reading of drawings needs an <code>ANTHROPIC_API_KEY</code> on the server. You can still upload images for reference and enter the
            measurements manually — the Excel file is generated the same way.
          </Banner>
        )}
        {(info?.aiMode === "demo" || anyDemo) && (
          <Banner tone="warn" title="Demo mode">
            The server is running with the demo analyser: results are a fixed example and are <b>not read from your image</b>. Do not use them for real work.
          </Banner>
        )}

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          {/* ------------------------- Left: images ------------------------- */}
          <div className="min-w-0 space-y-5 lg:sticky lg:top-20 lg:self-start">
            <Step n={1} title="Upload drawing" done={images.length > 0}>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
                }}
                className={cn(
                  "flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 py-6 text-center transition-colors",
                  dragOver ? "border-amber-600 bg-amber-50" : "border-stone-300 bg-stone-50/60",
                )}
              >
                <Upload className="mb-2 h-7 w-7 text-stone-400" aria-hidden />
                <p className="text-sm font-medium">Drag &amp; drop sketches here</p>
                <p className="mb-3 text-xs text-stone-500">Sketch photos (JPG, PNG, WEBP, PDF) · or an Excel file (.xlsx) to edit</p>
                <div className="flex flex-wrap justify-center gap-2">
                  <button type="button" onClick={() => fileInput.current?.click()} className="inline-flex items-center gap-1.5 rounded-xl bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800">
                    <ImagePlus className="h-4 w-4" /> Choose files
                  </button>
                  <button type="button" onClick={() => cameraInput.current?.click()} className="inline-flex items-center gap-1.5 rounded-xl border border-stone-300 bg-white px-4 py-2 text-sm font-medium hover:bg-stone-50 sm:hidden">
                    <Camera className="h-4 w-4" /> Take photo
                  </button>
                </div>
                <input
                  ref={fileInput}
                  type="file"
                  accept={ACCEPT_ATTR}
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.length) addFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
                <input
                  ref={cameraInput}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.length) addFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
              </div>
              <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-xl bg-stone-50 p-3 text-sm">
                <input type="checkbox" checked={autoMode} onChange={(e) => setAutoMode(e.target.checked)} className="mt-0.5 h-4 w-4 accent-amber-600" />
                <span>
                  <span className="font-medium">Automatic: analyse and download Excel on upload</span>
                  <span className="block text-xs text-stone-500">
                    The file downloads as soon as analysis finishes. Anything uncertain is marked “⚠ CHECK” in Remarks; edit below and download again.
                  </span>
                </span>
              </label>
              {notice && (
                <p className="mt-3 flex gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> {notice}
                </p>
              )}
              {uploadErrors.map((err, i) => (
                <p key={i} className="mt-2 flex gap-1.5 text-sm text-red-700">
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0" /> {err}
                </p>
              ))}

              {images.length > 0 && (
                <ul className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {images.map((img, i) => (
                    <li key={img.id} className="relative">
                      <button
                        type="button"
                        onClick={() => setSelectedImageId(img.id)}
                        className={cn(
                          "block aspect-square w-full overflow-hidden rounded-xl border-2 bg-white",
                          img.id === selectedImageId ? "border-amber-600" : "border-transparent",
                        )}
                        title={img.name}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL */}
                        <img src={img.processedUrl ?? img.originalUrl} alt={img.name} className="h-full w-full object-cover" />
                      </button>
                      <span className="absolute left-1 top-1 rounded-md bg-black/70 px-1.5 text-[11px] font-semibold text-white">{i + 1}</span>
                      <StatusDot img={img} />
                    </li>
                  ))}
                </ul>
              )}
            </Step>

            {selected && (
              <Step n={2} title="Preview & prepare" done={selected.status === "done"} id="preview">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <p className="min-w-0 flex-1 truncate text-sm text-stone-600" title={selected.name}>
                    {selected.name}
                  </p>
                  <button
                    type="button"
                    onClick={() => setEditingId(selected.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm hover:bg-stone-50"
                  >
                    <SlidersHorizontal className="h-4 w-4" /> Rotate / crop / clean
                  </button>
                  <button type="button" onClick={() => removeImage(selected.id)} className="rounded-lg p-2 text-stone-500 hover:bg-red-50 hover:text-red-700" aria-label="Remove image">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
                  {selected.processed && selected.processedUrl ? (
                    <AnnotatedImage
                      src={selected.processedUrl}
                      width={selected.processed.width}
                      height={selected.processed.height}
                      items={selectedItems}
                      tokens={selected.analysis?.tokens ?? []}
                      colorOf={colorOf}
                      showOverlay={showOverlay && selected.status === "done"}
                      showTokens={showUnused}
                      highlight={highlight}
                      onSelectItem={(id) => document.getElementById(`row-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}
                    />
                  ) : (
                    <div className="flex aspect-[4/3] items-center justify-center text-sm text-stone-500">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Preparing image…
                    </div>
                  )}
                </div>

                {selected.status === "done" && (
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm">
                    <label className="inline-flex items-center gap-2">
                      <input type="checkbox" checked={showOverlay} onChange={(e) => setShowOverlay(e.target.checked)} className="h-4 w-4 accent-amber-600" />
                      Show detected measurements
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input type="checkbox" checked={showUnused} onChange={(e) => setShowUnused(e.target.checked)} className="h-4 w-4 accent-red-600" />
                      Mark unused numbers
                    </label>
                  </div>
                )}

                {selected.qualityWarnings.length > 0 && (
                  <ul className="mt-3 space-y-1">
                    {selected.qualityWarnings.map((w) => (
                      <li key={w} className="flex gap-1.5 text-xs text-amber-800">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {w}
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-4 space-y-2">
                  <label className="block text-xs font-semibold uppercase tracking-wide text-stone-500" htmlFor="hints">
                    Notes for the AI (optional)
                  </label>
                  <textarea
                    id="hints"
                    rows={2}
                    value={selected.hints}
                    onChange={(e) => patchImage(selected.id, { hints: e.target.value })}
                    placeholder='e.g. "Room is MBR. Values are in mm. 2440+320 means wardrobe 2440 and loft 320."'
                    className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20"
                  />
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={!selected.processed || selected.status === "analyzing" || info?.aiMode === "none" || needsCode}
                    onClick={() => analyze(selected)}
                    className="inline-flex items-center gap-2 rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {selected.status === "analyzing" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
                    {selected.status === "analyzing"
                      ? `Analysing… ${Math.round((now - (selected.startedAt ?? now)) / 1000)}s`
                      : selected.status === "done"
                        ? "Analyse again"
                        : "Analyse drawing"}
                  </button>
                  {images.length > 1 && (
                    <button
                      type="button"
                      disabled={anyAnalyzing || info?.aiMode === "none" || needsCode || images.every((i) => i.status === "done")}
                      onClick={analyzeAll}
                      className="inline-flex items-center gap-2 rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium hover:bg-stone-50 disabled:opacity-50"
                    >
                      <Layers className="h-4 w-4" /> Analyse all images
                    </button>
                  )}
                </div>
                {selected.status === "analyzing" && (
                  <p className="mt-2 text-xs text-stone-500">Reading the handwriting, then matching each number to its dimension line. This usually takes 30–120 seconds.</p>
                )}
                {selected.status === "error" && selected.error && (
                  <p className="mt-2 flex gap-1.5 text-sm text-red-700">
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0" /> {selected.error}
                  </p>
                )}
              </Step>
            )}
          </div>

          {/* ------------------------- Right: review ------------------------ */}
          <div className="min-w-0 space-y-5">
            {images.some((i) => i.analysis) && (
              <Step n={3} title="Detected drawing" done={images.every((i) => i.status === "done")}>
                <ul className="space-y-3">
                  {images
                    .filter((i) => i.analysis)
                    .map((img) => {
                      const a = img.analysis as AnalysisResult;
                      return (
                        <li key={img.id} className="rounded-2xl border border-stone-200 bg-white p-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="flex-1 text-sm font-medium">
                              {images.length > 1 && <span className="mr-1 text-stone-400">Image {images.indexOf(img) + 1}:</span>}
                              {a.summary}
                            </p>
                            <label className="inline-flex items-center gap-1.5 text-xs text-stone-600">
                              Drawing unit
                              <select
                                value={a.drawingUnit}
                                onChange={(e) => setImageUnit(img.seq, e.target.value as LengthUnit)}
                                className={cn("rounded-lg border bg-white px-1.5 py-1 text-xs", a.unitSource === "inferred" ? "border-amber-400" : "border-stone-300")}
                              >
                                {LENGTH_UNITS.map((u) => (
                                  <option key={u} value={u}>
                                    {UNIT_LABELS[u]}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>
                          <p className="mt-1 text-xs text-stone-500">
                            {a.items.length} component{a.items.length === 1 ? "" : "s"} · {a.tokens.filter((t) => t.kind === "number" || t.kind === "expression").length} numbers read
                          </p>
                          {a.warnings.length > 0 && (
                            <ul className="mt-2 space-y-1">
                              {a.warnings.map((w, i) => (
                                <li key={i} className="flex gap-1.5 text-xs text-amber-800">
                                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {w}
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      );
                    })}
                </ul>
              </Step>
            )}

            <Step n={4} title="Review & correct measurements" done={items.length > 0 && reviewCount === 0}>
              {profile && (
                <p className="mb-4 text-sm text-stone-600">
                  Each card is one row of <b>{profile.config.sheet}</b>. Values stay in the drawing&apos;s unit here and are converted to{" "}
                  <b>{profile.config.inputUnit}</b> ({profile.config.decimals} decimals) in the Excel file.{" "}
                  <span className="whitespace-nowrap">
                    <Legend className="bg-emerald-500" /> ≥95%
                  </span>{" "}
                  <span className="whitespace-nowrap">
                    <Legend className="bg-amber-500" /> 80–94%
                  </span>{" "}
                  <span className="whitespace-nowrap">
                    <Legend className="bg-red-500" /> needs review
                  </span>
                </p>
              )}
              {items.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-stone-300 p-6 text-center text-sm text-stone-500">
                  {images.length ? "Analyse a drawing to fill in the rows, or add them manually." : "Upload a drawing to begin, or add rows manually."}
                </div>
              ) : (
                <div className="space-y-3">
                  {items.map((it, i) => (
                    <ItemCard
                      key={it.id}
                      item={it}
                      index={i}
                      total={items.length}
                      profile={profile!}
                      color={colorOf(it.id)}
                      imageLabel={imageLabel(it.imageIndex)}
                      highlighted={highlight?.itemId === it.id}
                      onChange={updateItem}
                      onRemove={() => removeItem(it.id)}
                      onMove={(d) => moveItem(it.id, d)}
                      onHover={(h) => {
                        setHighlight(h);
                        if (h) {
                          const img = images.find((x) => x.seq === it.imageIndex);
                          if (img && img.id !== selectedImageId) setSelectedImageId(img.id);
                        }
                      }}
                    />
                  ))}
                </div>
              )}
              <datalist id="sketch-rooms">
                {roomOptions.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
              <datalist id="sketch-items">
                {itemOptions.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
              <button
                type="button"
                onClick={addManualRow}
                disabled={!profile}
                className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-stone-300 bg-white px-3.5 py-2 text-sm font-medium hover:bg-stone-50 disabled:opacity-50"
              >
                <Plus className="h-4 w-4" /> Add row manually
              </button>
            </Step>

            {profile && items.length > 0 && (
              <Step n={5} title="Generate & download Excel" done={Boolean(lastFile)}>
                <ExcelPreview items={items} profile={profile} />

                {blockers.length > 0 ? (
                  <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4">
                    <p className="mb-2 text-sm font-semibold text-amber-900">
                      {blockers.length} item{blockers.length === 1 ? "" : "s"} to check. You can download now as a draft — doubtful values are marked “⚠ CHECK” in
                      Remarks and missing ones are left blank — or fix them first:
                    </p>
                    <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
                      {blockers.map((b, i) => (
                        <li key={i}>
                          <button
                            type="button"
                            className="text-left text-amber-900 underline decoration-amber-400 underline-offset-2 hover:text-amber-700"
                            onClick={() => b.itemId && document.getElementById(`row-${b.itemId}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}
                          >
                            {b.message}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="mt-4 flex gap-1.5 text-sm text-emerald-800">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> All measurements are confirmed. The Excel file will be final (no CHECK marks).
                  </p>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => generate("user")}
                    disabled={generating || needsCode}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold shadow-sm disabled:cursor-not-allowed disabled:opacity-40",
                      blockers.length ? "border border-amber-500 bg-white text-amber-900 hover:bg-amber-50" : "bg-stone-900 text-white hover:bg-stone-800",
                    )}
                  >
                    {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                    {blockers.length
                      ? lastFile ? "Download updated draft Excel" : "Download draft Excel"
                      : lastFile ? "Generate & download updated Excel" : "Generate & download Excel"}
                  </button>
                  {lastFile && !dirty && (
                    <button
                      type="button"
                      onClick={() => saveBlob(lastFile.blob, lastFile.fileName)}
                      className="inline-flex items-center gap-2 rounded-xl border border-emerald-600 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
                    >
                      <Download className="h-4 w-4" /> Download {lastFile.fileName}
                    </button>
                  )}
                </div>
                {lastFile && (
                  <p className={cn("mt-2 text-xs", dirty ? "font-medium text-amber-800" : "text-stone-500")}>
                    {dirty
                      ? "You have changed the rows since the last download — download again to get the updated file."
                      : `${lastFile.rows} rows written into a copy of the template${lastFile.draft ? ` (draft, ${lastFile.checks} to check)` : ""}. Formulas recalculate when the file is opened.`}
                  </p>
                )}
                {generateError && (
                  <p className="mt-2 flex gap-1.5 text-sm text-red-700">
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0" /> {generateError}
                  </p>
                )}
              </Step>
            )}
          </div>
        </div>
      </main>

      {editing && (
        <ImageEditor
          name={editing.name}
          original={editing.original}
          originalUrl={editing.originalUrl}
          processedUrl={editing.processedUrl}
          processing={editing.processing}
          settings={editing.settings}
          onChange={(s) => patchImage(editing.id, { settings: s })}
          onClose={() => setEditingId(null)}
        />
      )}
    </div>
  );
}

function Legend({ className }: { className: string }) {
  return <span className={cn("inline-block h-2 w-2 rounded-full align-middle", className)} />;
}

function StatusDot({ img }: { img: SketchImage }) {
  if (img.status === "analyzing") return <Loader2 className="absolute bottom-1 right-1 h-4 w-4 animate-spin rounded-full bg-white text-amber-600" />;
  if (img.status === "done") return <CheckCircle2 className="absolute bottom-1 right-1 h-4 w-4 rounded-full bg-white text-emerald-600" />;
  if (img.status === "error") return <XCircle className="absolute bottom-1 right-1 h-4 w-4 rounded-full bg-white text-red-600" />;
  return null;
}

function Banner({ tone, title, children }: { tone: "error" | "warn"; title: string; children: React.ReactNode }) {
  return (
    <div className={cn("rounded-2xl border p-4 text-sm", tone === "error" ? "border-red-300 bg-red-50 text-red-900" : "border-amber-300 bg-amber-50 text-amber-950")}>
      <p className="mb-1 flex items-center gap-1.5 font-semibold">
        <AlertTriangle className="h-4 w-4" /> {title}
      </p>
      <div>{children}</div>
    </div>
  );
}
