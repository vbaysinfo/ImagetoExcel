import { checkAccess } from "@/lib/sketch/auth";
import { SketchError, errorResponse } from "@/lib/sketch/errors";
import { importRows } from "@/lib/sketch/excel/importRows";
import { loadTemplate } from "@/lib/sketch/templates/store";

const MAX_BYTES = 10 * 1024 * 1024;

/** Load an existing workbook's rows into the editor. */
export async function POST(request: Request) {
  try {
    checkAccess(request);
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) throw new SketchError("NO_FILE", "No Excel file was uploaded.");
    if (!/\.xlsx$/i.test(file.name)) {
      throw new SketchError("EXCEL_TYPE", "Please upload an .xlsx file (Excel 2007 or newer).", 415);
    }
    if (file.size > MAX_BYTES) throw new SketchError("EXCEL_TOO_LARGE", "The Excel file is larger than 10 MB.", 413);
    const { profile } = await loadTemplate();
    let items;
    try {
      items = await importRows(Buffer.from(await file.arrayBuffer()), profile);
    } catch (e) {
      throw new SketchError("EXCEL_UNREADABLE", e instanceof Error ? e.message : "The Excel file could not be read.", 422);
    }
    if (!items.length) {
      throw new SketchError("EXCEL_EMPTY", `No rows were found in "${profile.config.sheet}" from row ${profile.config.firstDataRow} onwards.`, 422);
    }
    return Response.json({ items, fileName: file.name });
  } catch (e) {
    return errorResponse(e);
  }
}
