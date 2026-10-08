/**
 * The analysis pipeline:
 *
 *   prepared image → OCR (transcription) → AI interpretation → validation
 *
 * Image preprocessing happens in the browser before upload (see
 * `lib/sketch/image`), so the user can see and adjust it.
 */
import "server-only";
import { ClaudeInterpretationProvider, ClaudeOcrProvider, aiConfigured } from "../ai/claude";
import { DemoInterpretationProvider, DemoOcrProvider } from "../ai/demo";
import type { InterpretationProvider, OcrProvider, PreparedImage } from "../ai/provider";
import { SketchError } from "../errors";
import type { AnalysisResult, TemplateProfile } from "../types";
import { buildAnalysis, buildTokens } from "../validation/validate";

export function providerMode(): "claude" | "demo" | "none" {
  if (process.env.SKETCH_AI_PROVIDER === "demo") return "demo";
  return aiConfigured() ? "claude" : "none";
}

function providers(): { ocr: OcrProvider; interpreter: InterpretationProvider; demo: boolean } {
  if (providerMode() === "demo") {
    return { ocr: new DemoOcrProvider(), interpreter: new DemoInterpretationProvider(), demo: true };
  }
  return { ocr: new ClaudeOcrProvider(), interpreter: new ClaudeInterpretationProvider(), demo: false };
}

export async function analyzeSketch(opts: {
  image: PreparedImage;
  imageIndex: number;
  profile: TemplateProfile;
  hints: string;
  qualityWarnings: string[];
}): Promise<AnalysisResult> {
  const { ocr, interpreter, demo } = providers();

  const ocrPass = await ocr.transcribe(opts.image);
  const tokens = buildTokens(ocrPass);
  if (!demo && tokens.filter((t) => t.kind === "number" || t.kind === "expression").length === 0) {
    if (!ocrPass.image_quality.legible) {
      throw new SketchError(
        "UNREADABLE_IMAGE",
        "No measurements could be read — the image looks blurry or too dark. Please retake the photo straight on, in good light, and try again.",
        422,
      );
    }
    throw new SketchError(
      "NO_MEASUREMENTS",
      "No measurement numbers were found on this image. Check that the whole drawing is in the photo, or enter the rows manually.",
      422,
    );
  }

  const interpretation = await interpreter.interpret(opts.image, tokens, opts.profile, opts.hints);
  return buildAnalysis({
    imageIndex: opts.imageIndex,
    ocr: ocrPass,
    tokens,
    interpretation,
    config: opts.profile.config,
    provider: `${ocr.name} + ${interpreter.name}`,
    demo,
    qualityWarnings: opts.qualityWarnings,
  });
}
