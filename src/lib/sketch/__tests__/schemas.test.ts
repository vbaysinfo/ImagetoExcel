import { describe, expect, it } from "vitest";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { InterpretationSchema, OcrPassSchema } from "../ai/schemas";
import { interpretationSystem } from "../ai/prompts";
import { analyzeTemplate } from "../excel/analyzeTemplate";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("AI structured-output schemas", () => {
  it("convert to strict JSON schemas the API accepts", () => {
    for (const schema of [OcrPassSchema, InterpretationSchema]) {
      const format = betaZodOutputFormat(schema) as unknown as { type: string; schema: Record<string, unknown> };
      expect(format.type).toBe("json_schema");
      const json = JSON.stringify(format.schema);
      // Every object must forbid extra keys; no numeric constraints are allowed.
      expect(json).toContain('"additionalProperties":false');
      expect(json).not.toMatch(/"(minimum|maximum|minLength|maxLength)"/);
    }
  });

  it("builds the interpretation prompt from the template", async () => {
    const file = readFileSync(path.join(process.cwd(), "templates/default/template.xlsx"));
    const profile = await analyzeTemplate(file, { id: "default", name: "t", fileName: "t", uploadedAt: null, builtIn: true });
    const prompt = interpretationSystem(profile);
    expect(prompt).toContain('column D "Width (ft)"');
    expect(prompt).toContain("MBR | Wardrobe Shutter | 8 | 7 |");
    expect(prompt).toContain("optional");
  });
});
