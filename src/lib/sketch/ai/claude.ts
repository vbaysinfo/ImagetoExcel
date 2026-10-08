/**
 * Claude vision implementation of the OCR and interpretation stages.
 * Server only: the API key is read from the environment and never sent to
 * the browser.
 */
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { SketchError } from "../errors";
import type { OcrToken, TemplateProfile } from "../types";
import type { InterpretationProvider, OcrProvider, PreparedImage } from "./provider";
import { InterpretationSchema, OcrPassSchema } from "./schemas";
import { OCR_SYSTEM, interpretationSystem, interpretationUserText } from "./prompts";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

const MODEL = process.env.SKETCH_AI_MODEL || "claude-opus-5-5";
const OCR_EFFORT = (process.env.SKETCH_OCR_EFFORT || "medium") as Effort;
const INTERPRET_EFFORT = (process.env.SKETCH_AI_EFFORT || "high") as Effort;

/** Models that accept the server-side refusal fallback ("default" routing). */
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!aiConfigured()) {
    throw new SketchError(
      "AI_NOT_CONFIGURED",
      "AI analysis is not configured on the server (ANTHROPIC_API_KEY is missing). You can still enter the measurements manually.",
      503,
    );
  }
  client ??= new Anthropic({ timeout: 5 * 60 * 1000, maxRetries: 2 });
  return client;
}

async function runStructured<S extends z.ZodType>(opts: {
  schema: S;
  system: string;
  image: PreparedImage;
  text: string;
  effort: Effort;
  stage: string;
}): Promise<z.infer<S>> {
  const anthropic = getClient();
  const useFallback = FALLBACK_MODELS.has(MODEL);
  try {
    const stream = anthropic.beta.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      thinking: { type: "adaptive" },
      output_config: { effort: opts.effort, format: betaZodOutputFormat(opts.schema) },
      ...(useFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      system: opts.system,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: opts.image.mediaType, data: opts.image.base64 } },
            { type: "text", text: opts.text },
          ],
        },
      ],
    });
    const message = await stream.finalMessage();
    if (message.stop_reason === "refusal") {
      throw new SketchError("AI_REFUSED", "The AI declined to analyse this image. Please check it is a measurement sketch, or enter the values manually.", 422);
    }
    if (message.stop_reason === "max_tokens") {
      throw new SketchError("AI_TRUNCATED", "The drawing produced more output than expected. Try cropping it to fewer components per image.", 422);
    }
    const parsed = message.parsed_output;
    if (!parsed) {
      throw new SketchError("AI_BAD_OUTPUT", `The ${opts.stage} step returned an unreadable result. Please try again.`, 502);
    }
    return parsed as z.infer<S>;
  } catch (e) {
    if (e instanceof SketchError) throw e;
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      throw new SketchError("AI_AUTH", "The AI service rejected the server's credentials. Ask the administrator to check ANTHROPIC_API_KEY.", 503);
    }
    if (e instanceof Anthropic.RateLimitError) {
      throw new SketchError("AI_BUSY", "The AI service is busy right now. Please wait a minute and try again.", 429);
    }
    if (e instanceof Anthropic.BadRequestError) {
      throw new SketchError("AI_BAD_REQUEST", `The AI service could not process this image (${e.message}). Try a smaller or clearer image.`, 422);
    }
    if (e instanceof Anthropic.APIConnectionError) {
      throw new SketchError("AI_UNREACHABLE", "Could not reach the AI service. Check the server's internet connection and try again.", 503);
    }
    if (e instanceof Anthropic.APIError) {
      throw new SketchError("AI_ERROR", `The AI service returned an error (${e.status ?? "unknown"}). Please try again.`, 502);
    }
    throw e;
  }
}

export class ClaudeOcrProvider implements OcrProvider {
  readonly name = `claude-ocr:${MODEL}`;
  transcribe(image: PreparedImage) {
    return runStructured({
      schema: OcrPassSchema,
      system: OCR_SYSTEM,
      image,
      text: "Transcribe all text on this drawing.",
      effort: OCR_EFFORT,
      stage: "OCR",
    });
  }
}

export class ClaudeInterpretationProvider implements InterpretationProvider {
  readonly name = `claude-vision:${MODEL}`;
  interpret(image: PreparedImage, tokens: OcrToken[], profile: TemplateProfile, hints: string) {
    return runStructured({
      schema: InterpretationSchema,
      system: interpretationSystem(profile),
      image,
      text: interpretationUserText(tokens, hints),
      effort: INTERPRET_EFFORT,
      stage: "interpretation",
    });
  }
}
