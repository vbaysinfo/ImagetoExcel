# Image to Excel

Turn photos of hand-drawn, dimensioned sketches (wardrobes, lofts, kitchens,
TV units, partitions…) into a populated copy of your **Price Calculator**
Excel template.

Built with Next.js 16 (App Router), TypeScript, Tailwind CSS v4, Claude vision
(via the Anthropic SDK, server-side only) and a formatting-preserving XLSX
writer.


**Flow:** upload (JPG/PNG/WEBP/PDF, several pages, or phone camera) → prepare
(rotate, straighten, 4-corner crop with perspective correction, automatic
paper detection, shadow removal, contrast, sharpening, zoom, compare with
original) → analyse → review & correct → generate → download
`converted_measurement_YYYY-MM-DD.xlsx`.

**Works without an API key — tap-to-enter mode.** When no
`ANTHROPIC_API_KEY` is set, the tool runs entirely without AI: upload the
sketch, tap each number on the drawing and type it (Enter saves and moves
width → height → depth → next row). Quick-add buttons create rows named like
your template ("Loft", "Left Expo", "Wardrobe Shutter"…). Values are marked on
the drawing, calculated live with the template's formulas and exported the
same way. (Free OCR such as Tesseract was tested and cannot read handwritten
dimensions reliably, so it is not used.)

**Automatic mode** (only with an API key; on by default): uploading a sketch prepares it (the sheet
of paper is detected and cropped), analyses it and downloads the Excel file
straight away. If anything is uncertain the file is a *draft*
(`…_draft.xlsx`): doubtful values are written with a `⚠ CHECK: …` note in
Remarks and values that could not be found are left blank. Correct them in the
editor and download again; the final file has no CHECK notes.

**Blank sizes are highlighted:** a size that is not written on the sketch is
left blank and its row is marked `⚠ CHECK` in Remarks. In Excel those blank
width/height cells show in red (conditional formatting) until a value is typed.

**Edit an existing Excel file:** drop a generated (or hand-filled) `.xlsx` on
the upload area. Its rows are loaded into the editor using the active
template's mapping; rows marked `⚠ CHECK` open highlighted so you can fill or
confirm them, then download the updated file.

## Setup

1. Copy `.env.example` to `.env.local` and set `ANTHROPIC_API_KEY` (and
   `SKETCH_ADMIN_TOKEN`, plus `SKETCH_ACCESS_CODE` on a public deployment).
2. `npm run dev` and open <http://localhost:3000>.
3. Template setup: <http://localhost:3000/admin>.

Without an API key the tool works in tap-to-enter mode (see above).

## The Excel template

The built-in master template is `templates/default/template.xlsx` (the
supplied `test3.xlsx`) with its mapping in `templates/default/config.json`.
Inspection of that workbook found:

| | |
|---|---|
| Sheet | `Price Calculator` (only sheet), header on row 1, frozen below it, rows 2–54 pre-formatted |
| Inputs (blue text, yellow fill) | A S.No · B Room (only on the first row of each room) · C Item · D Width (ft) · E Height (ft) · F Depth (ft, **blank = frame/shutter**) · L Remarks |
| Formulas (grey fill) | G/H/I = D/E/F × 304.8 (mm, format `0`) · J = "Area (Sq.ft)" or "Volume (Cu.ft)" · K = D×E or D×E×F (format `0.00`) |
| Units | Inputs in **feet**; sketches are in **mm**, so values are converted (÷304.8, 2 decimals) and the original mm values go into Remarks |

Generation edits a copy of the workbook's XML in place (`src/lib/sketch/excel`),
so fonts, fills, borders, number formats, column widths, row heights, frozen
panes, print setup and formulas are preserved exactly. Formula results are
pre-computed by evaluating the template's own formulas and Excel recalculates
on open. More rows than the template has are added with the same styling and
formulas. A new template uploaded on the admin page is analysed automatically
(header row, input vs. formula columns, units, sample rows) and the mapping
can be adjusted there.

## Accuracy safeguards

- Two separate AI passes: **OCR** (transcribe every number/label exactly,
  with alternative readings for ambiguous digits) and **interpretation**
  (assign numbers to components and width/height/depth, citing the OCR
  tokens used).
- **Validation** (`src/lib/sketch/validation`) downgrades to *needs review*
  any value that is not traceable to text on the drawing, uses an alternative
  reading, comes from arithmetic that does not check out, or is implausible.
- Confidence: ≥95% high, 80–94% medium, <80% needs review. Missing required
  values show "Unable to confidently identify this measurement. Please
  confirm." The Excel file cannot be generated until every flagged value is
  confirmed or corrected — nothing is invented.
- Verification overlay draws each detected dimension ("W = 2800 mm") and
  component on the image; unused numbers are marked in red.

## Code map

```
src/lib/sketch/
  image/        browser preprocessing (rotate, perspective, enhance, PDF)
  ai/           OCR + interpretation providers (Claude vision), prompts, schemas
  validation/   evidence checks and confidence scoring
  calc/         unit conversion, Excel formula evaluator, row calculation
  excel/        template inspection, formatting-preserving XLSX writer
  templates/    template storage (built-in + uploaded)
  pipeline/     analysis orchestration
src/app/api/sketch/   REST API (analyze, generate, template, admin)
src/components/sketch/ UI
src/app/page.tsx      the tool  ·  src/app/admin/page.tsx  template setup
```

Tests: `npm test`.
