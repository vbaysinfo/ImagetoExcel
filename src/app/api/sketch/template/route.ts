import { accessCodeRequired } from "@/lib/sketch/auth";
import { errorResponse } from "@/lib/sketch/errors";
import { providerMode } from "@/lib/sketch/pipeline/analyze";
import { loadTemplate } from "@/lib/sketch/templates/store";

/** Active template profile + server capabilities for the tool UI. */
export async function GET() {
  try {
    const { profile } = await loadTemplate();
    return Response.json(
      { profile, aiMode: providerMode(), accessCodeRequired: accessCodeRequired() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
