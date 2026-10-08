/** Browser-side calls to the tool's API routes. */
import type { AnalysisResult, GenerateRow, TemplateProfile } from "../types";

const ACCESS_KEY = "sketch-access-code";
const ADMIN_KEY = "sketch-admin-token";

function stored(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function setStored(key: "access" | "admin", value: string) {
  try {
    localStorage.setItem(key === "access" ? ACCESS_KEY : ADMIN_KEY, value);
  } catch {
    // Private mode: the code is simply asked for again next time.
  }
}

export const getAccessCode = () => stored(ACCESS_KEY);
export const getAdminToken = () => stored(ADMIN_KEY);

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function failure(res: Response): Promise<never> {
  let code = "HTTP_" + res.status;
  let message = `The server returned an error (${res.status}).`;
  try {
    const body = await res.json();
    if (body?.error?.message) {
      code = body.error.code;
      message = body.error.message;
    }
  } catch {
    if (res.status === 413) message = "The upload is too large for the server.";
    if (res.status === 504) message = "The analysis took too long and timed out. Try cropping the image to a smaller area.";
  }
  throw new ApiError(code, message, res.status);
}

async function request(input: string, init: RequestInit = {}, admin = false): Promise<Response> {
  const headers = new Headers(init.headers);
  const code = getAccessCode();
  if (code) headers.set("x-access-code", code);
  if (admin) headers.set("x-admin-token", getAdminToken());
  let res: Response;
  try {
    res = await fetch(input, { ...init, headers });
  } catch {
    throw new ApiError("NETWORK", "Could not reach the server. Check your internet connection and try again.", 0);
  }
  if (!res.ok) await failure(res);
  return res;
}

export interface ToolInfo {
  profile: TemplateProfile;
  aiMode: "claude" | "demo" | "none";
  accessCodeRequired: boolean;
}

export async function fetchToolInfo(): Promise<ToolInfo> {
  return (await request("/api/sketch/template")).json();
}

export async function analyzeImage(opts: {
  blob: Blob;
  width: number;
  height: number;
  imageIndex: number;
  hints: string;
  qualityWarnings: string[];
  signal?: AbortSignal;
}): Promise<AnalysisResult> {
  const form = new FormData();
  form.set("image", opts.blob, "drawing.jpg");
  form.set("width", String(opts.width));
  form.set("height", String(opts.height));
  form.set("imageIndex", String(opts.imageIndex));
  form.set("hints", opts.hints);
  form.set("qualityWarnings", JSON.stringify(opts.qualityWarnings));
  return (await request("/api/sketch/analyze", { method: "POST", body: form, signal: opts.signal })).json();
}

export async function generateExcel(rows: GenerateRow[]): Promise<{ blob: Blob; fileName: string }> {
  const res = await request("/api/sketch/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows }),
  });
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const fileName = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "converted_measurement.xlsx";
  return { blob: await res.blob(), fileName };
}

/* ------------------------------ Admin --------------------------------- */

export interface TemplateListEntry {
  id: string;
  name: string;
  fileName: string;
  uploadedAt: string | null;
  builtIn: boolean;
  active: boolean;
}

export async function adminList(): Promise<TemplateListEntry[]> {
  return (await (await request("/api/sketch/admin/templates", {}, true)).json()).templates;
}

export async function adminProfile(id: string): Promise<TemplateProfile> {
  return (await (await request(`/api/sketch/admin/templates/${id}`, {}, true)).json()).profile;
}

export async function adminUpload(file: File, name: string): Promise<TemplateProfile> {
  const form = new FormData();
  form.set("file", file);
  form.set("name", name);
  return (await (await request("/api/sketch/admin/templates", { method: "POST", body: form }, true)).json()).profile;
}

export async function adminPatch(id: string, body: object): Promise<TemplateProfile> {
  const res = await request(
    `/api/sketch/admin/templates/${id}`,
    { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    true,
  );
  return (await res.json()).profile;
}

export async function adminDelete(id: string): Promise<void> {
  await request(`/api/sketch/admin/templates/${id}`, { method: "DELETE" }, true);
}

export async function adminDownload(id: string): Promise<Blob> {
  return (await request(`/api/sketch/admin/templates/${id}?download=1`, {}, true)).blob();
}

export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
