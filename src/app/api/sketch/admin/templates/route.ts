import { checkAdmin } from "@/lib/sketch/auth";
import { SketchError, errorResponse } from "@/lib/sketch/errors";
import { listTemplates, saveUploadedTemplate, setActiveTemplate } from "@/lib/sketch/templates/store";

export async function GET(request: Request) {
  try {
    checkAdmin(request);
    return Response.json({ templates: await listTemplates() }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Upload a new Excel sample. It is analysed, stored, and made active. */
export async function POST(request: Request) {
  try {
    checkAdmin(request);
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) throw new SketchError("NO_FILE", "No Excel file was uploaded.");
    const name = String(form?.get("name") ?? "").slice(0, 120);
    const profile = await saveUploadedTemplate(Buffer.from(await file.arrayBuffer()), file.name, name);
    await setActiveTemplate(profile.config.id);
    return Response.json({ profile });
  } catch (e) {
    return errorResponse(e);
  }
}
