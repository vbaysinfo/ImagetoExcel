"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Download, FileSpreadsheet, Loader2, Save, Star, Trash2, Upload, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ApiError,
  adminDelete,
  adminDownload,
  adminList,
  adminPatch,
  adminProfile,
  adminUpload,
  getAdminToken,
  saveBlob,
  setStored,
  type TemplateListEntry,
} from "@/lib/sketch/client/api";
import type { DimensionKey, MappingField, TemplateConfig, TemplateProfile } from "@/lib/sketch/types";
import { LENGTH_UNITS } from "@/lib/sketch/types";
import { UNIT_LABELS } from "@/lib/sketch/units";

const FIELDS: { key: MappingField; label: string }[] = [
  { key: "serial", label: "Serial number" },
  { key: "room", label: "Room" },
  { key: "item", label: "Item / description" },
  { key: "width", label: "Width" },
  { key: "height", label: "Height" },
  { key: "depth", label: "Depth" },
  { key: "remarks", label: "Remarks" },
];

export function TemplateAdmin() {
  const [templates, setTemplates] = useState<TemplateListEntry[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [profile, setProfile] = useState<TemplateProfile | null>(null);
  const [draft, setDraft] = useState<TemplateConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [needsToken, setNeedsToken] = useState(false);
  const [token, setToken] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");

  const handle = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.code === "ADMIN_DENIED") {
      setNeedsToken(true);
      setToken(getAdminToken());
    }
    setError(e instanceof Error ? e.message : "Something went wrong.");
  }, []);

  const showProfile = (p: TemplateProfile) => {
    setProfile(p);
    setDraft(p.config);
    setSelectedId(p.config.id);
  };

  const refresh = useCallback(async (select?: string) => {
    try {
      const list = await adminList();
      setTemplates(list);
      setNeedsToken(false);
      const id = select ?? list.find((t) => t.active)?.id ?? list[0]?.id;
      if (id) showProfile(await adminProfile(id));
    } catch (e) {
      handle(e);
    }
  }, [handle]);

  useEffect(() => {
    // Initial load; state is only set once the request resolves.
    adminList().then(
      () => refresh(),
      (e: unknown) => handle(e),
    );
  }, [refresh, handle]);

  const run = async (fn: () => Promise<void>, ok?: string) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await fn();
      if (ok) setMessage(ok);
    } catch (e) {
      handle(e);
    } finally {
      setBusy(false);
    }
  };

  const columnOptions = profile?.columns ?? [];
  const setCol = (k: MappingField, v: string) => draft && setDraft({ ...draft, columns: { ...draft.columns, [k]: v || undefined } });

  return (
    <div className="min-h-screen bg-[#f5f3ef] text-stone-900">
      <header className="sticky top-0 z-40 border-b border-stone-200 bg-[#f5f3ef]/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link href="/" className="rounded-lg p-2 hover:bg-stone-200/60" aria-label="Back to the tool">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-base font-semibold sm:text-lg">Excel template setup</h1>
            <p className="text-xs text-stone-500">Upload the master Excel sample and map sketch data to its cells.</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6">
        {needsToken && (
          <form
            className="flex flex-wrap items-center gap-2 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm"
            onSubmit={(e) => {
              e.preventDefault();
              setStored("admin", token.trim());
              setError(null);
              refresh();
            }}
          >
            <span className="font-medium">Admin token:</span>
            <input type="password" value={token} onChange={(e) => setToken(e.target.value)} className="rounded-lg border border-stone-300 bg-white px-3 py-1.5" />
            <button className="rounded-lg bg-stone-900 px-3 py-1.5 font-medium text-white">Unlock</button>
          </form>
        )}
        {error && (
          <p className="flex gap-2 rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </p>
        )}
        {message && (
          <p className="flex gap-2 rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-800">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> {message}
          </p>
        )}

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="min-w-0 space-y-5">
            <section className="rounded-3xl border border-stone-200 bg-white p-5">
              <h2 className="mb-3 font-semibold">Upload a new Excel sample</h2>
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!file) return;
                  run(async () => {
                    const p = await adminUpload(file, name);
                    setFile(null);
                    setName("");
                    await refresh(p.config.id);
                  }, "Template uploaded, analysed and set as active. Check the mapping below.");
                }}
              >
                <input
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-stone-900 file:px-3 file:py-1.5 file:text-white"
                />
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)" className="w-full rounded-lg border border-stone-300 px-3 py-1.5 text-sm" />
                <button disabled={!file || busy} className="inline-flex items-center gap-1.5 rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Upload &amp; analyse
                </button>
                <p className="text-xs text-stone-500">The file is stored on the server and never modified; every export is generated from a copy.</p>
              </form>
            </section>

            <section className="rounded-3xl border border-stone-200 bg-white p-5">
              <h2 className="mb-3 font-semibold">Templates</h2>
              {!templates ? (
                <p className="text-sm text-stone-500">{needsToken ? "Locked." : "Loading…"}</p>
              ) : (
                <ul className="space-y-2">
                  {templates.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => run(async () => showProfile(await adminProfile(t.id)))}
                        className={cn("w-full rounded-xl border p-3 text-left text-sm", t.id === selectedId ? "border-amber-600 bg-amber-50" : "border-stone-200 hover:bg-stone-50")}
                      >
                        <span className="flex items-center gap-2 font-medium">
                          <FileSpreadsheet className="h-4 w-4 text-emerald-700" /> {t.name}
                          {t.active && <span className="ml-auto rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold uppercase text-white">Active</span>}
                        </span>
                        <span className="mt-0.5 block text-xs text-stone-500">
                          {t.fileName} · {t.builtIn ? "built-in" : `uploaded ${t.uploadedAt ? new Date(t.uploadedAt).toLocaleString() : ""}`}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {profile && draft && (
            <div className="min-w-0 space-y-5">
              <section className="rounded-3xl border border-stone-200 bg-white p-5">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <h2 className="flex-1 font-semibold">Template inspection — {profile.fileName}</h2>
                  {!templates?.find((t) => t.id === profile.config.id)?.active && (
                    <button type="button" disabled={busy} onClick={() => run(async () => { await adminPatch(profile.config.id, { activate: true }); await refresh(profile.config.id); }, "Template activated.")} className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-50">
                      <Star className="h-4 w-4" /> Use this template
                    </button>
                  )}
                  <button type="button" onClick={() => run(async () => saveBlob(await adminDownload(profile.config.id), profile.fileName))} className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-50">
                    <Download className="h-4 w-4" /> Original
                  </button>
                  {!profile.builtIn && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (confirm(`Delete template "${profile.config.name}"? This cannot be undone.`)) {
                          run(async () => { await adminDelete(profile.config.id); await refresh(); }, "Template deleted.");
                        }
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="h-4 w-4" /> Delete
                    </button>
                  )}
                </div>
                <ul className="list-disc space-y-1 pl-5 text-sm text-stone-700">
                  {profile.findings.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full text-left text-xs">
                    <thead className="text-stone-500">
                      <tr>
                        <th className="py-1 pr-3">Col</th>
                        <th className="py-1 pr-3">Header</th>
                        <th className="py-1 pr-3">Role</th>
                        <th className="py-1 pr-3">Unit</th>
                        <th className="py-1 pr-3">Number format</th>
                        <th className="py-1 pr-3">Formula (row {profile.config.firstDataRow})</th>
                      </tr>
                    </thead>
                    <tbody>
                      {profile.columns.map((c) => (
                        <tr key={c.column} className="border-t border-stone-100 align-top">
                          <td className="py-1.5 pr-3 font-mono font-semibold">{c.column}</td>
                          <td className="whitespace-pre-line py-1.5 pr-3">{c.header}</td>
                          <td className="py-1.5 pr-3">{c.role}</td>
                          <td className="py-1.5 pr-3">{c.unit ?? ""}</td>
                          <td className="py-1.5 pr-3 font-mono">{c.numberFormat}</td>
                          <td className="py-1.5 pr-3 font-mono text-stone-600">{c.formula ? `=${c.formula}` : ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="rounded-3xl border border-stone-200 bg-white p-5">
                <h2 className="mb-1 font-semibold">Mapping</h2>
                <p className="mb-4 text-sm text-stone-500">Which cells receive the data extracted from sketches.</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Name">
                    <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={inputCls} />
                  </Field>
                  <Field label="Sheet">
                    <select value={draft.sheet} onChange={(e) => setDraft({ ...draft, sheet: e.target.value })} className={inputCls}>
                      {profile.sheets.map((s) => (
                        <option key={s.name}>{s.name}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Header row">
                    <input type="number" min={1} value={draft.headerRow} onChange={(e) => setDraft({ ...draft, headerRow: Number(e.target.value) })} className={inputCls} />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="First data row">
                      <input type="number" min={1} value={draft.firstDataRow} onChange={(e) => setDraft({ ...draft, firstDataRow: Number(e.target.value) })} className={inputCls} />
                    </Field>
                    <Field label="Last formatted row">
                      <input type="number" min={1} value={draft.lastDataRow} onChange={(e) => setDraft({ ...draft, lastDataRow: Number(e.target.value) })} className={inputCls} />
                    </Field>
                  </div>
                  {FIELDS.map(({ key, label }) => (
                    <Field key={key} label={`${label} column`}>
                      <select value={draft.columns[key] ?? ""} onChange={(e) => setCol(key, e.target.value)} className={inputCls}>
                        <option value="">— not used —</option>
                        {columnOptions.map((c) => (
                          <option key={c.column} value={c.column} disabled={c.role === "formula"}>
                            {c.column} — {c.header.replace(/\s+/g, " ") || "(no header)"}
                            {c.role === "formula" ? " (formula)" : ""}
                          </option>
                        ))}
                      </select>
                    </Field>
                  ))}
                  <Field label="Unit of the dimension columns">
                    <select value={draft.inputUnit} onChange={(e) => setDraft({ ...draft, inputUnit: e.target.value as TemplateConfig["inputUnit"] })} className={inputCls}>
                      {LENGTH_UNITS.map((u) => (
                        <option key={u} value={u}>
                          {UNIT_LABELS[u]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Decimal places">
                    <input type="number" min={0} max={6} value={draft.decimals} onChange={(e) => setDraft({ ...draft, decimals: Number(e.target.value) })} className={inputCls} />
                  </Field>
                  <Field label="Required dimensions">
                    <div className="flex gap-4 pt-1 text-sm">
                      {(["width", "height", "depth"] as DimensionKey[]).map((k) => (
                        <label key={k} className="inline-flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={draft.requiredFields.includes(k)}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                requiredFields: e.target.checked ? [...draft.requiredFields, k] : draft.requiredFields.filter((x) => x !== k),
                              })
                            }
                            className="accent-amber-600"
                          />
                          {k}
                        </label>
                      ))}
                    </div>
                  </Field>
                  <Field label="Room column">
                    <select value={draft.roomMode} onChange={(e) => setDraft({ ...draft, roomMode: e.target.value as TemplateConfig["roomMode"] })} className={inputCls}>
                      <option value="first-of-group">Only on the first row of each room</option>
                      <option value="every-row">On every row</option>
                    </select>
                  </Field>
                  <Field label="Serial numbers">
                    <select value={draft.serialMode} onChange={(e) => setDraft({ ...draft, serialMode: e.target.value as TemplateConfig["serialMode"] })} className={inputCls}>
                      <option value="renumber">Renumber 1, 2, 3…</option>
                      <option value="keep">Keep the template&apos;s values</option>
                    </select>
                  </Field>
                  <Field label="Remarks column">
                    <select value={draft.remarksMode} onChange={(e) => setDraft({ ...draft, remarksMode: e.target.value as TemplateConfig["remarksMode"] })} className={inputCls}>
                      <option value="source-dimensions">Original sketch dimensions</option>
                      <option value="notes">AI notes</option>
                      <option value="none">Leave empty</option>
                    </select>
                  </Field>
                  <Field label="Unused template rows">
                    <label className="inline-flex items-center gap-2 pt-1 text-sm">
                      <input type="checkbox" checked={draft.clearUnusedRows} onChange={(e) => setDraft({ ...draft, clearUnusedRows: e.target.checked })} className="accent-amber-600" />
                      Clear sample data from rows that are not used
                    </label>
                  </Field>
                </div>
                <div className="mt-5 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const { id: _id, ...config } = draft;
                        void _id;
                        showProfile(await adminPatch(profile.config.id, { config }));
                      }, "Mapping saved.")
                    }
                    className="inline-flex items-center gap-1.5 rounded-xl bg-stone-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save mapping
                  </button>
                  {profile.builtIn && (
                    <button type="button" disabled={busy} onClick={() => run(async () => showProfile(await adminPatch(profile.config.id, { reset: true })), "Mapping reset to the shipped defaults.")} className="rounded-xl border border-stone-300 px-4 py-2 text-sm hover:bg-stone-50">
                      Reset to defaults
                    </button>
                  )}
                </div>
              </section>

              {profile.exampleRows.length > 0 && (
                <section className="rounded-3xl border border-stone-200 bg-white p-5">
                  <h2 className="mb-1 font-semibold">Sample rows in the template</h2>
                  <p className="mb-3 text-sm text-stone-500">Shown to the AI as examples of how furniture is split into rows. They are cleared from generated files.</p>
                  <div className="max-h-72 overflow-auto">
                    <table className="min-w-full text-xs">
                      <thead className="sticky top-0 bg-white text-left text-stone-500">
                        <tr>
                          <th className="py-1 pr-3">Room</th>
                          <th className="py-1 pr-3">Item</th>
                          <th className="py-1 pr-3">W</th>
                          <th className="py-1 pr-3">H</th>
                          <th className="py-1 pr-3">D</th>
                        </tr>
                      </thead>
                      <tbody>
                        {profile.exampleRows.map((r, i) => (
                          <tr key={i} className="border-t border-stone-100">
                            <td className="py-1 pr-3">{r.room}</td>
                            <td className="py-1 pr-3">{r.item}</td>
                            <td className="py-1 pr-3 tabular-nums">{r.width ?? ""}</td>
                            <td className="py-1 pr-3 tabular-nums">{r.height ?? ""}</td>
                            <td className="py-1 pr-3 tabular-nums">{r.depth ?? ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

const inputCls = "w-full rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</span>
      {children}
    </label>
  );
}
