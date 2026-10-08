import { z } from "zod";
import { checkAdmin } from "@/lib/sketch/auth";
import { SketchError, errorResponse } from "@/lib/sketch/errors";
import {
  deleteTemplate,
  loadTemplate,
  readTemplateFile,
  resetTemplateConfig,
  setActiveTemplate,
  updateTemplateConfig,
} from "@/lib/sketch/templates/store";

const col = z.string().regex(/^[A-Z]{1,3}$/).optional();
const ConfigSchema = z
  .object({
    name: z.string().min(1).max(120),
    sheet: z.string().min(1),
    headerRow: z.number().int().min(1),
    firstDataRow: z.number().int().min(1),
    lastDataRow: z.number().int().min(1),
    columns: z.object({ serial: col, room: col, item: col, width: col, height: col, depth: col, remarks: col }),
    inputUnit: z.enum(["mm", "cm", "m", "in", "ft"]),
    decimals: z.number().int().min(0).max(6),
    requiredFields: z.array(z.enum(["width", "height", "depth"])),
    roomMode: z.enum(["first-of-group", "every-row"]),
    serialMode: z.enum(["renumber", "keep"]),
    remarksMode: z.enum(["source-dimensions", "notes", "none"]),
    clearUnusedRows: z.boolean(),
  })
  .partial();

const PatchSchema = z.object({
  activate: z.boolean().optional(),
  reset: z.boolean().optional(),
  config: ConfigSchema.optional(),
});

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    checkAdmin(request);
    const { id } = await ctx.params;
    const url = new URL(request.url);
    if (url.searchParams.get("download") === "1") {
      const { buffer, fileName } = await readTemplateFile(id);
      return new Response(new Uint8Array(buffer), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${fileName.replace(/"/g, "")}"`,
        },
      });
    }
    const { profile } = await loadTemplate(id);
    return Response.json({ profile }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    checkAdmin(request);
    const { id } = await ctx.params;
    const parsed = PatchSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new SketchError("BAD_CONFIG", "The mapping is invalid: " + parsed.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; "));
    const { activate, reset, config } = parsed.data;
    if (reset) await resetTemplateConfig(id);
    if (config) {
      if (config.firstDataRow && config.lastDataRow && config.lastDataRow < config.firstDataRow) {
        throw new SketchError("BAD_CONFIG", "The last data row must be after the first data row.");
      }
      await updateTemplateConfig(id, config);
    }
    if (activate) await setActiveTemplate(id);
    const { profile } = await loadTemplate(id);
    return Response.json({ profile });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    checkAdmin(request);
    const { id } = await ctx.params;
    await deleteTemplate(id);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
