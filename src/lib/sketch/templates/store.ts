/**
 * Template storage (server only).
 *
 * - The built-in template ships with the app in `templates/default/`.
 * - Templates uploaded by an administrator, mapping edits and the choice of
 *   active template live in TEMPLATE_STORAGE_DIR (default ./storage/templates),
 *   which is outside the public folder and never served directly.
 * - Template files are read-only once stored; generation always works on an
 *   in-memory copy.
 */
import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { analyzeTemplate } from "../excel/analyzeTemplate";
import { SketchError } from "../errors";
import type { TemplateConfig, TemplateProfile } from "../types";

const BUILTIN_ID = "default";
const BUILTIN_DIR = path.join(process.cwd(), "templates", BUILTIN_ID);
const MAX_TEMPLATE_BYTES = 10 * 1024 * 1024;

function storageDir(): string {
  return process.env.TEMPLATE_STORAGE_DIR || path.join(process.cwd(), "storage", "templates");
}

function assertId(id: string): void {
  if (!/^[a-z0-9-]{1,64}$/.test(id)) throw new SketchError("TEMPLATE_NOT_FOUND", "Unknown template.", 404);
}

interface StoredMeta {
  name: string;
  fileName: string;
  uploadedAt: string | null;
  config?: Partial<TemplateConfig>;
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

async function writeJson(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

async function loadMeta(id: string): Promise<{ meta: StoredMeta; file: string; builtIn: boolean }> {
  assertId(id);
  if (id === BUILTIN_ID) {
    const base = await readJson<StoredMeta>(path.join(BUILTIN_DIR, "config.json"));
    if (!base) throw new SketchError("TEMPLATE_MISSING", "The built-in Excel template is missing from the server.", 500);
    // Mapping edits made from the admin screen are stored separately.
    const override = await readJson<Partial<StoredMeta>>(path.join(storageDir(), BUILTIN_ID, "meta.json"));
    return {
      meta: {
        ...base,
        uploadedAt: null,
        config: { ...base.config, ...(override?.config ?? {}) },
      },
      file: path.join(BUILTIN_DIR, "template.xlsx"),
      builtIn: true,
    };
  }
  const meta = await readJson<StoredMeta>(path.join(storageDir(), id, "meta.json"));
  if (!meta) throw new SketchError("TEMPLATE_NOT_FOUND", "That Excel template no longer exists.", 404);
  return { meta, file: path.join(storageDir(), id, "template.xlsx"), builtIn: false };
}

export async function getActiveTemplateId(): Promise<string> {
  const active = await readJson<{ id: string }>(path.join(storageDir(), "active.json"));
  if (active?.id) {
    try {
      await loadMeta(active.id);
      return active.id;
    } catch {
      // Fall back to the built-in template.
    }
  }
  return BUILTIN_ID;
}

export async function loadTemplate(id?: string): Promise<{ profile: TemplateProfile; buffer: Buffer }> {
  const templateId = id ?? (await getActiveTemplateId());
  const { meta, file, builtIn } = await loadMeta(templateId);
  let buffer: Buffer;
  try {
    buffer = await fs.readFile(file);
  } catch {
    throw new SketchError(
      "TEMPLATE_MISSING",
      "The Excel template file is missing on the server. Ask the administrator to upload it again.",
      500,
    );
  }
  try {
    const profile = await analyzeTemplate(
      buffer,
      { id: templateId, name: meta.name, fileName: meta.fileName, uploadedAt: meta.uploadedAt, builtIn },
      meta.config,
    );
    return { profile, buffer };
  } catch (e) {
    throw new SketchError(
      "TEMPLATE_INVALID",
      `The Excel template could not be read: ${e instanceof Error ? e.message : "unknown error"}`,
      500,
    );
  }
}

export async function listTemplates(): Promise<{ id: string; name: string; fileName: string; uploadedAt: string | null; builtIn: boolean; active: boolean }[]> {
  const activeId = await getActiveTemplateId();
  const ids = [BUILTIN_ID];
  try {
    for (const entry of await fs.readdir(storageDir(), { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== BUILTIN_ID && /^[a-z0-9-]+$/.test(entry.name)) ids.push(entry.name);
    }
  } catch {
    // Storage folder not created yet.
  }
  const out = [];
  for (const id of ids) {
    try {
      const { meta, builtIn } = await loadMeta(id);
      out.push({ id, name: meta.name, fileName: meta.fileName, uploadedAt: meta.uploadedAt, builtIn, active: id === activeId });
    } catch {
      // Skip broken entries.
    }
  }
  return out;
}

export async function saveUploadedTemplate(data: Buffer, fileName: string, name: string): Promise<TemplateProfile> {
  if (data.byteLength > MAX_TEMPLATE_BYTES) {
    throw new SketchError("TEMPLATE_TOO_LARGE", "The Excel file is larger than 10 MB.", 413);
  }
  if (!/\.xlsx$/i.test(fileName)) {
    throw new SketchError("TEMPLATE_TYPE", "Please upload an .xlsx workbook (Excel 2007 or newer). Older .xls files are not supported.");
  }
  const id = `t-${randomBytes(6).toString("hex")}`;
  const meta: StoredMeta = { name: name || fileName.replace(/\.xlsx$/i, ""), fileName, uploadedAt: new Date().toISOString() };
  // Validate before storing anything.
  let profile: TemplateProfile;
  try {
    profile = await analyzeTemplate(data, { id, ...meta, builtIn: false });
  } catch (e) {
    throw new SketchError(
      "TEMPLATE_INVALID",
      `This workbook could not be analysed: ${e instanceof Error ? e.message : "unknown error"}`,
    );
  }
  const dir = path.join(storageDir(), id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "template.xlsx"), data, { mode: 0o600 });
  await writeJson(path.join(dir, "meta.json"), { ...meta, config: profile.config });
  return profile;
}

export async function updateTemplateConfig(id: string, config: Partial<TemplateConfig>): Promise<TemplateProfile> {
  const { meta } = await loadMeta(id);
  const next: StoredMeta = { ...meta, config: { ...(meta.config ?? {}), ...config } };
  delete next.config?.id;
  if (id === BUILTIN_ID) {
    await writeJson(path.join(storageDir(), BUILTIN_ID, "meta.json"), { config: next.config });
  } else {
    await writeJson(path.join(storageDir(), id, "meta.json"), next);
  }
  return (await loadTemplate(id)).profile;
}

export async function resetTemplateConfig(id: string): Promise<void> {
  assertId(id);
  if (id === BUILTIN_ID) await fs.rm(path.join(storageDir(), BUILTIN_ID, "meta.json"), { force: true });
}

export async function setActiveTemplate(id: string): Promise<void> {
  await loadMeta(id);
  await writeJson(path.join(storageDir(), "active.json"), { id });
}

export async function deleteTemplate(id: string): Promise<void> {
  assertId(id);
  if (id === BUILTIN_ID) throw new SketchError("TEMPLATE_BUILTIN", "The built-in template cannot be deleted.");
  await fs.rm(path.join(storageDir(), id), { recursive: true, force: true });
  if ((await getActiveTemplateId()) === id) await setActiveTemplate(BUILTIN_ID);
}

export async function readTemplateFile(id: string): Promise<{ buffer: Buffer; fileName: string }> {
  const { meta, file } = await loadMeta(id);
  return { buffer: await fs.readFile(file), fileName: meta.fileName };
}
