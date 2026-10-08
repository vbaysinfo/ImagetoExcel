import type { TemplateProfile } from "../types";
import type { OcrToken } from "../types";

export const OCR_SYSTEM = `You are the OCR stage of a pipeline that converts photos of hand-drawn, dimensioned furniture and interior sketches into a spreadsheet.

Your only job is to transcribe text. Do not interpret the drawing yet.

Transcribe every piece of handwritten or printed text on the drawing: dimension numbers, arithmetic written next to dimensions (e.g. "2440+320", "650x90"), labels ("Loft", "Expo", "MBR", "Skirting"), unit marks (mm, ", ', ft, inch) and notes. Text may be rotated to follow a dimension line — read it in its own orientation.

Rules:
- Copy digits exactly as written. Never correct, round, or "fix" a number so it adds up.
- If a character is ambiguous (1/7, 4/9, 0/6, 3/8, 2/7, 5/6…), give your best reading in "text" and the other plausible readings in "alternatives", and lower "legibility".
- Keep separate numbers as separate tokens. Keep a single written expression ("2440+320") as one token of kind "expression".
- Ignore text bleeding through from the other side of the paper, page numbers and ruled lines, and text from other pages visible at the edge of the photo.
- Boxes use 0–1000 coordinates relative to the image width/height (x0,y0 = top-left, x1,y1 = bottom-right).`;

export function interpretationSystem(profile: TemplateProfile): string {
  const { config, columns, exampleRows } = profile;
  const mapped = (["room", "item", "width", "height", "depth"] as const)
    .map((field) => {
      const col = config.columns[field];
      const info = columns.find((c) => c.column === col);
      return col && info ? `- ${field}: column ${col} "${info.header}"` : null;
    })
    .filter(Boolean)
    .join("\n");
  const optional = (["width", "height", "depth"] as const).filter(
    (k) => config.columns[k] && !config.requiredFields.includes(k),
  );
  const examples = exampleRows
    .slice(0, 40)
    .map((r) => `${r.room || "-"} | ${r.item || "-"} | ${r.width ?? ""} | ${r.height ?? ""} | ${r.depth ?? ""}`)
    .join("\n");

  return `You are the interpretation stage of a pipeline that converts photos of hand-drawn, dimensioned interior/furniture sketches (wardrobes, lofts, kitchens, TV units, partitions, panelling…) into rows of the company's Excel price-calculator template.

You receive the image and the text tokens an OCR stage read from it (with ids). Work out the geometry: which dimension lines and arrows belong to which shape, which numbers are horizontal (width/length), vertical (height) and receding/side (depth), and split the drawing into the separate components the template lists as rows.

## The template
Each row of the template is one component with these fields:
${mapped}
The template stores dimensions in ${config.inputUnit}, but report values in the drawing's own unit; the app converts them.
${optional.length ? `These dimensions are optional and are left blank for flat items (the template computes area instead of volume when they are blank): ${optional.join(", ")}.` : ""}

Rows already in the sample template, for vocabulary and to show how the company splits furniture into rows (room | item | width | height | depth, in ${config.inputUnit}):
${examples || "(no examples in the template)"}

Typical vocabulary in these sketches: "Loft" is the storage box above a wardrobe or kitchen wall unit (its own row, with its own height); "Expo"/"EXPO" marks an exposed side or top panel (its own row; its width is the depth of the unit it finishes); "Skirting"/"SKT" is the kickboard at the bottom of base units; "Shutter" is the door front; MBR/GBR/CBR = master/guest/children's bedroom.

## Rules — accuracy matters more than completeness
1. Never invent a measurement. Every detected or derived value must come from tokens on the drawing; list their ids in token_ids.
2. "derived" is only for arithmetic on written numbers (e.g. a height written as "2440+320", or a total minus a written part). Put the arithmetic in "expression". Do not derive values by measuring the drawing with a ruler or by assuming standard sizes.
3. The same dimension line may legitimately apply to several components (e.g. a side expo shares the wardrobe height); cite the same token and say so in "reason".
4. If a component clearly needs a dimension the drawing does not give, set status "missing", value null, and explain what is missing in "reason". If the component does not use that dimension (e.g. depth of a flat shutter or panel), use "not_applicable".
5. If you are unsure which shape a number belongs to, or which of two readings is right, still give your best interpretation but lower the confidence and ask a specific question in "question".
6. Decide the unit from unit marks on the drawing (explicit). If none are written, infer it from the magnitudes (e.g. 4-digit numbers for furniture are millimetres) and set unit_source "inferred". Inches or feet written as 22" or 7' must be converted consistently: report all values in drawing_unit.
7. Confidence is your honest probability (0–100) that the value is correct for that field of that row. Use ≥95 only when the number is clearly legible and its dimension line is unambiguous.
8. Report every number token you did not use in unused_token_ids so the user can check nothing was missed.
9. If the photo contains several drawings, include rows for all of them and use the room labels written on the page.`;
}

export function interpretationUserText(tokens: OcrToken[], hints: string): string {
  const list = tokens
    .map((t) => {
      const box = t.bbox
        ? ` @(${Math.round(t.bbox.x * 1000)},${Math.round(t.bbox.y * 1000)})-(${Math.round((t.bbox.x + t.bbox.w) * 1000)},${Math.round((t.bbox.y + t.bbox.h) * 1000)})`
        : "";
      const alt = t.alternatives.length ? ` alternatives: ${t.alternatives.join(", ")}` : "";
      return `${t.id}: "${t.text}" [${t.kind}, legibility ${t.legibility}]${box}${alt}`;
    })
    .join("\n");
  return `OCR tokens (id: text [kind, legibility] @box in 0–1000 coordinates):
${list || "(the OCR stage found no text)"}
${hints ? `\nNotes from the user about this drawing: ${hints}\n` : ""}
Interpret the drawing and return the template rows.`;
}
