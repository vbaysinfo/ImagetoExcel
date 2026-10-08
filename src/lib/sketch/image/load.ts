/** Turn uploaded files (images or PDFs) into canvases, in the browser. */
import { createCanvas, downscale } from "./ops";

export const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
export const ACCEPT_ATTR =
  ".jpg,.jpeg,.png,.webp,.pdf,.xlsx,image/jpeg,image/png,image/webp,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function isExcel(file: File) {
  return /\.xlsx$/i.test(file.name) || file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}
/** Working resolution kept in memory for editing. */
const WORKING_EDGE = 3000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_PDF_PAGES = 10;

export interface LoadedPage {
  name: string;
  canvas: HTMLCanvasElement;
}

function isPdf(file: File) {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

export async function loadFile(file: File): Promise<LoadedPage[]> {
  if (file.size > MAX_FILE_BYTES) throw new Error(`"${file.name}" is larger than 25 MB.`);
  if (isPdf(file)) return loadPdf(file);
  if (!ACCEPTED_TYPES.includes(file.type) && !/\.(jpe?g|png|webp)$/i.test(file.name)) {
    throw new Error(`"${file.name}" is not a supported file. Please upload JPG, PNG, WEBP or PDF.`);
  }
  let bitmap: ImageBitmap;
  try {
    // Applies the EXIF orientation from phone cameras.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error(`"${file.name}" could not be opened. The file may be damaged or in an unsupported format (e.g. HEIC).`);
  }
  const c = createCanvas(bitmap.width, bitmap.height);
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("Canvas is not supported in this browser.");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return [{ name: file.name, canvas: downscale(c, WORKING_EDGE) }];
}

async function loadPdf(file: File): Promise<LoadedPage[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  } catch {
    throw new Error(`"${file.name}" could not be opened as a PDF.`);
  }
  const pages: LoadedPage[] = [];
  const count = Math.min(doc.numPages, MAX_PDF_PAGES);
  for (let i = 1; i <= count; i++) {
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(4, WORKING_EDGE / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale });
    const c = createCanvas(viewport.width, viewport.height);
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("Canvas is not supported in this browser.");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvas: c, canvasContext: ctx, viewport }).promise;
    pages.push({ name: doc.numPages > 1 ? `${file.name} — page ${i}` : file.name, canvas: c });
  }
  await doc.cleanup();
  return pages;
}
