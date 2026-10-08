/**
 * Provider interfaces. The OCR stage and the interpretation stage are
 * separate so either can be swapped (e.g. a dedicated handwriting OCR
 * service) without touching the rest of the pipeline.
 */
import type { TemplateProfile } from "../types";
import type { OcrToken } from "../types";
import type { Interpretation, OcrPass } from "./schemas";

export interface PreparedImage {
  base64: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  width: number | null;
  height: number | null;
}

export interface OcrProvider {
  readonly name: string;
  transcribe(image: PreparedImage): Promise<OcrPass>;
}

export interface InterpretationProvider {
  readonly name: string;
  interpret(
    image: PreparedImage,
    tokens: OcrToken[],
    profile: TemplateProfile,
    hints: string,
  ): Promise<Interpretation>;
}
