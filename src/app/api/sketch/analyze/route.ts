import { checkAccess } from "@/lib/sketch/auth";
import { SketchError, errorResponse } from "@/lib/sketch/errors";
import { analyzeSketch } from "@/lib/sketch/pipeline/analyze";
import { loadTemplate } from "@/lib/sketch/templates/store";
import type { PreparedImage } from "@/lib/sketch/ai/provider";

// Two vision passes on a detailed drawing can take a while.
export const maxDuration = 300;

/** Claude accepts at most 5 MB of base64 per image (≈3.75 MB of bytes). */
const MAX_IMAGE_BYTES = 3_700_000;

function sniffMediaType(bytes: Uint8Array): PreparedImage["mediaType"] | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") {
    return "image/webp";
  }
  if (String.fromCharCode(...bytes.slice(0, 3)) === "GIF") return "image/gif";
  return null;
}

export async function POST(request: Request) {
  try {
    checkAccess(request);
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new SketchError("BAD_UPLOAD", "The upload could not be read. Please try again.");
    }
    const file = form.get("image");
    if (!(file instanceof File)) throw new SketchError("NO_IMAGE", "No image was uploaded.");
    if (file.size === 0) throw new SketchError("EMPTY_IMAGE", "The uploaded image is empty.");
    if (file.size > MAX_IMAGE_BYTES) {
      throw new SketchError("IMAGE_TOO_LARGE", "The prepared image is too large (over 3.7 MB). Crop it or reduce the quality and try again.", 413);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mediaType = sniffMediaType(bytes);
    if (!mediaType) {
      throw new SketchError("UNSUPPORTED_IMAGE", "Unsupported image format. Please upload a JPG, PNG or WEBP image (or a PDF).", 415);
    }

    const width = Number(form.get("width")) || null;
    const height = Number(form.get("height")) || null;
    const imageIndex = Number(form.get("imageIndex")) || 0;
    const hints = String(form.get("hints") ?? "").slice(0, 2000);
    let qualityWarnings: string[] = [];
    try {
      const parsed = JSON.parse(String(form.get("qualityWarnings") ?? "[]"));
      if (Array.isArray(parsed)) qualityWarnings = parsed.map(String).slice(0, 10);
    } catch {
      // Ignore malformed hints.
    }
    if (width && height && Math.max(width, height) < 600) {
      qualityWarnings.push("The image resolution is very low; small handwriting may be misread.");
    }

    const templateId = form.get("templateId");
    const { profile } = await loadTemplate(typeof templateId === "string" && templateId ? templateId : undefined);

    const result = await analyzeSketch({
      image: { base64: Buffer.from(bytes).toString("base64"), mediaType, width, height },
      imageIndex,
      profile,
      hints,
      qualityWarnings,
    });
    return Response.json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
