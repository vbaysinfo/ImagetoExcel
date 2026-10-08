import { z } from "zod";
import { checkAccess } from "@/lib/sketch/auth";
import { SketchError, errorResponse } from "@/lib/sketch/errors";
import { generateWorkbook, outputFileName } from "@/lib/sketch/excel/generate";
import { loadTemplate } from "@/lib/sketch/templates/store";

const num = z.number().finite().positive().max(1_000_000).nullable();
const BodySchema = z.object({
  templateId: z.string().optional(),
  /** Draft export: rows may still have blank required values (marked for checking in Remarks). */
  draft: z.boolean().optional(),
  rows: z
    .array(
      z.object({
        room: z.string().max(200),
        item: z.string().max(300),
        widthMm: num,
        heightMm: num,
        depthMm: num,
        remarks: z.string().max(1000),
      }),
    )
    .min(1)
    .max(2000),
});

export async function POST(request: Request) {
  try {
    checkAccess(request);
    let body: z.infer<typeof BodySchema>;
    try {
      body = BodySchema.parse(await request.json());
    } catch {
      throw new SketchError("BAD_ROWS", "The measurements sent for export are incomplete or invalid. Please review the table and try again.");
    }
    const { profile, buffer } = await loadTemplate(body.templateId || undefined);

    // Never write a row the template cannot calculate.
    const required = profile.config.requiredFields;
    const incomplete = body.rows.findIndex((r) =>
      required.some((k) => r[`${k}Mm` as "widthMm" | "heightMm" | "depthMm"] === null),
    );
    if (incomplete !== -1 && !body.draft) {
      throw new SketchError(
        "INCOMPLETE_ROW",
        `Row ${incomplete + 1} is missing a required measurement (${required.join(", ")}). Please complete it before generating the Excel file.`,
      );
    }

    let result;
    try {
      result = await generateWorkbook(buffer, profile, body.rows);
    } catch (e) {
      console.error("[sketch-to-excel] generation failed", e);
      throw new SketchError("EXCEL_FAILED", "The Excel file could not be generated from the template. Please contact the administrator.", 500);
    }
    const fileName = outputFileName();
    return new Response(new Uint8Array(result.buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "X-Rows-Written": String(result.rowsWritten),
        "X-Rows-Added": String(result.rowsAdded),
        "X-Draft": body.draft ? "1" : "0",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
