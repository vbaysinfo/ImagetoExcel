/**
 * Browser-side image preprocessing for photos of drawings.
 *
 * Runs on <canvas> pixel data so the user sees the result before it is sent
 * for analysis. The original upload is always kept untouched.
 */

export type Point = { x: number; y: number };
/** Four corners (top-left, top-right, bottom-right, bottom-left), normalised 0–1. */
export type Quad = [Point, Point, Point, Point];

export const FULL_QUAD: Quad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

export interface EnhanceOptions {
  /** Flatten uneven lighting and remove shadows. */
  cleanBackground: boolean;
  /** Stretch contrast so paper is white and ink is dark. */
  contrast: boolean;
  /** Darken faint pen/pencil strokes. */
  boostFaint: boolean;
  sharpen: boolean;
  grayscale: boolean;
}

export const DEFAULT_ENHANCE: EnhanceOptions = {
  cleanBackground: true,
  contrast: true,
  boostFaint: false,
  sharpen: true,
  grayscale: false,
};

export function createCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas is not supported in this browser.");
  return ctx;
}

/** Scale down so the longest edge is at most `maxEdge`. */
export function downscale(src: HTMLCanvasElement, maxEdge: number): HTMLCanvasElement {
  const scale = Math.min(1, maxEdge / Math.max(src.width, src.height));
  if (scale >= 1) return src;
  const out = createCanvas(src.width * scale, src.height * scale);
  const ctx = ctx2d(out);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, out.width, out.height);
  return out;
}

/** Rotate by any angle (degrees, clockwise), expanding the canvas; fills with white. */
export function rotate(src: HTMLCanvasElement, degrees: number): HTMLCanvasElement {
  const a = (((degrees % 360) + 360) % 360) * (Math.PI / 180);
  if (a === 0) return src;
  const cos = Math.abs(Math.cos(a));
  const sin = Math.abs(Math.sin(a));
  const w = src.width * cos + src.height * sin;
  const h = src.width * sin + src.height * cos;
  const out = createCanvas(w, h);
  const ctx = ctx2d(out);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate(a);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return out;
}

/* ---------------------------- Perspective ------------------------------ */

/** Solve the 3×3 homography mapping 4 `from` points onto 4 `to` points. */
function homography(from: Point[], to: Point[]): number[] {
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i];
    const { x: u, y: v } = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  // Gaussian elimination with partial pivoting on the 8×9 augmented matrix.
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    const d = A[c][c];
    if (Math.abs(d) < 1e-12) throw new Error("Degenerate crop area");
    for (let k = c; k < 9; k++) A[c][k] /= d;
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c];
      for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
    }
  }
  return [...A.map((row) => row[8]), 1];
}

function dist(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function isFullQuad(q: Quad): boolean {
  return q.every((p, i) => dist(p, FULL_QUAD[i]) < 1e-3);
}

/**
 * Crop to the quadrilateral and correct its perspective so the paper becomes
 * a flat rectangle. A plain axis-aligned crop is the special case of a
 * rectangular quad.
 */
export function warpQuad(src: HTMLCanvasElement, quad: Quad): HTMLCanvasElement {
  if (isFullQuad(quad)) return src;
  const pts = quad.map((p) => ({ x: p.x * src.width, y: p.y * src.height }));
  const outW = Math.round(Math.max(dist(pts[0], pts[1]), dist(pts[3], pts[2])));
  const outH = Math.round(Math.max(dist(pts[0], pts[3]), dist(pts[1], pts[2])));
  if (outW < 10 || outH < 10) throw new Error("The crop area is too small.");

  // Axis-aligned rectangle: a plain crop is faster and lossless.
  const rect =
    Math.abs(pts[0].y - pts[1].y) < 1 && Math.abs(pts[3].y - pts[2].y) < 1 &&
    Math.abs(pts[0].x - pts[3].x) < 1 && Math.abs(pts[1].x - pts[2].x) < 1;
  if (rect) {
    const out = createCanvas(outW, outH);
    ctx2d(out).drawImage(src, pts[0].x, pts[0].y, outW, outH, 0, 0, outW, outH);
    return out;
  }

  const H = homography(
    [{ x: 0, y: 0 }, { x: outW, y: 0 }, { x: outW, y: outH }, { x: 0, y: outH }],
    pts,
  );
  const sctx = ctx2d(src);
  const s = sctx.getImageData(0, 0, src.width, src.height).data;
  const out = createCanvas(outW, outH);
  const octx = ctx2d(out);
  const img = octx.createImageData(outW, outH);
  const o = img.data;
  const sw = src.width;
  const sh = src.height;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const den = H[6] * x + H[7] * y + H[8];
      const fx = (H[0] * x + H[1] * y + H[2]) / den;
      const fy = (H[3] * x + H[4] * y + H[5]) / den;
      const oi = (y * outW + x) * 4;
      if (fx < 0 || fy < 0 || fx > sw - 1 || fy > sh - 1) {
        o[oi] = o[oi + 1] = o[oi + 2] = o[oi + 3] = 255;
        continue;
      }
      // Bilinear sampling.
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const x1 = Math.min(x0 + 1, sw - 1);
      const y1 = Math.min(y0 + 1, sh - 1);
      const ax = fx - x0;
      const ay = fy - y0;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = (y0 * sw + x1) * 4;
      const i01 = (y1 * sw + x0) * 4;
      const i11 = (y1 * sw + x1) * 4;
      for (let c = 0; c < 3; c++) {
        const top = s[i00 + c] * (1 - ax) + s[i10 + c] * ax;
        const bot = s[i01 + c] * (1 - ax) + s[i11 + c] * ax;
        o[oi + c] = top * (1 - ay) + bot * ay;
      }
      o[oi + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

/* ------------------------------ Enhance -------------------------------- */

function luminance(d: Uint8ClampedArray, n: number): Float32Array {
  const L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  return L;
}

/** Box blur via an integral image (O(n) regardless of radius). */
function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += src[y * w + x];
      I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const sum = I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
      out[y * w + x] = sum / ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
}

/** Separable max filter — removes thin dark ink so only the paper remains. */
function maxFilter(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) m = Math.max(m, src[y * w + k]);
      tmp[y * w + x] = m;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) m = Math.max(m, tmp[k * w + x]);
      out[y * w + x] = m;
    }
  }
  return out;
}

function percentile(values: Float32Array, p: number): number {
  const hist = new Uint32Array(256);
  for (const v of values) hist[Math.max(0, Math.min(255, Math.round(v)))]++;
  const target = values.length * p;
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= target) return i;
  }
  return 255;
}

export function enhance(src: HTMLCanvasElement, opts: EnhanceOptions): HTMLCanvasElement {
  if (!opts.cleanBackground && !opts.contrast && !opts.boostFaint && !opts.sharpen && !opts.grayscale) return src;
  const w = src.width;
  const h = src.height;
  const n = w * h;
  const data = ctx2d(src).getImageData(0, 0, w, h);
  const d = data.data;
  const L0 = luminance(d, n);
  const L = Float32Array.from(L0);

  if (opts.cleanBackground) {
    // Estimate the paper brightness on a small copy (fast), then divide.
    const small = Math.max(1, Math.round(Math.max(w, h) / 400));
    const sw = Math.ceil(w / small);
    const sh = Math.ceil(h / small);
    const S = new Float32Array(sw * sh);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) S[y * sw + x] = L[Math.min(h - 1, y * small) * w + Math.min(w - 1, x * small)];
    const bg = boxBlur(maxFilter(S, sw, sh, 3), sw, sh, Math.max(4, Math.round(Math.max(sw, sh) / 40)));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const b = Math.max(30, bg[Math.min(sh - 1, Math.floor(y / small)) * sw + Math.min(sw - 1, Math.floor(x / small))]);
        L[y * w + x] = Math.min(255, (L[y * w + x] / b) * 245);
      }
    }
  }

  if (opts.contrast) {
    const lo = percentile(L, 0.005);
    const hi = Math.max(lo + 30, percentile(L, 0.6));
    for (let i = 0; i < n; i++) L[i] = Math.max(0, Math.min(255, ((L[i] - lo) / (hi - lo)) * 255));
  }

  if (opts.boostFaint) {
    for (let i = 0; i < n; i++) L[i] = 255 * Math.pow(L[i] / 255, 1.8);
  }

  if (opts.sharpen) {
    const blur = boxBlur(L, w, h, 1);
    for (let i = 0; i < n; i++) L[i] = Math.max(0, Math.min(255, L[i] + 0.8 * (L[i] - blur[i])));
  }

  for (let i = 0; i < n; i++) {
    const j = i * 4;
    if (opts.grayscale) {
      d[j] = d[j + 1] = d[j + 2] = L[i];
    } else {
      // Keep the ink colour: scale RGB by the luminance change, then lift towards white.
      const ratio = L0[i] > 1 ? L[i] / L0[i] : 1;
      for (let c = 0; c < 3; c++) d[j + c] = Math.max(0, Math.min(255, d[j + c] * ratio));
      if (L[i] > 235) d[j] = d[j + 1] = d[j + 2] = Math.max(d[j], d[j + 1], d[j + 2], L[i]);
    }
  }
  const out = createCanvas(w, h);
  ctx2d(out).putImageData(data, 0, 0);
  return out;
}

/* --------------------------- Analysis helpers ---------------------------- */

/** Variance of the Laplacian on a ~800px copy: low values mean blur. */
export function sharpness(src: HTMLCanvasElement): number {
  const c = downscale(src, 800);
  const w = c.width;
  const h = c.height;
  const L = luminance(ctx2d(c).getImageData(0, 0, w, h).data, w * h);
  let sum = 0;
  let sum2 = 0;
  let count = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = 4 * L[i] - L[i - 1] - L[i + 1] - L[i - w] - L[i + w];
      sum += v;
      sum2 += v * v;
      count++;
    }
  }
  const mean = sum / count;
  return sum2 / count - mean * mean;
}

/**
 * Find the sheet of paper in a photo: the largest bright, low-saturation
 * region; its extreme points give the four corners. Returns null when no
 * clear paper boundary is found.
 */
export function detectPaper(src: HTMLCanvasElement): Quad | null {
  const c = downscale(src, 320);
  const w = c.width;
  const h = c.height;
  const n = w * h;
  const d = ctx2d(c).getImageData(0, 0, w, h).data;
  const L = new Float32Array(n);
  const sat = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = d[i * 4];
    const g = d[i * 4 + 1];
    const b = d[i * 4 + 2];
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    L[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    sat[i] = mx === 0 ? 0 : (mx - mn) / mx;
  }
  // Otsu threshold on brightness.
  const hist = new Array(256).fill(0);
  for (const v of L) hist[Math.round(v)]++;
  let total = 0;
  for (let i = 0; i < 256; i++) total += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (total - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  // Paper = bright and not strongly coloured; close small gaps (ink) with a blur.
  const mask0 = new Float32Array(n);
  for (let i = 0; i < n; i++) mask0[i] = L[i] > threshold && sat[i] < 0.35 ? 1 : 0;
  const blurred = boxBlur(mask0, w, h, 2);
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = blurred[i] > 0.5 ? 1 : 0;

  // Largest 4-connected component.
  const label = new Int32Array(n).fill(-1);
  let bestLabel = -1;
  let bestSize = 0;
  const stack: number[] = [];
  let next = 0;
  for (let i = 0; i < n; i++) {
    if (!mask[i] || label[i] !== -1) continue;
    let size = 0;
    stack.push(i);
    label[i] = next;
    while (stack.length) {
      const p = stack.pop() as number;
      size++;
      const x = p % w;
      const y = (p - x) / w;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of nb) {
        if (q >= 0 && mask[q] && label[q] === -1) {
          label[q] = next;
          stack.push(q);
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      bestLabel = next;
    }
    next++;
  }
  if (bestLabel < 0 || bestSize < n * 0.15) return null;

  let tl = { x: 0, y: 0, s: Infinity };
  let br = { x: 0, y: 0, s: -Infinity };
  let tr = { x: 0, y: 0, s: -Infinity };
  let bl = { x: 0, y: 0, s: Infinity };
  for (let i = 0; i < n; i++) {
    if (label[i] !== bestLabel) continue;
    const x = i % w;
    const y = (i - x) / w;
    if (x + y < tl.s) tl = { x, y, s: x + y };
    if (x + y > br.s) br = { x, y, s: x + y };
    if (x - y > tr.s) tr = { x, y, s: x - y };
    if (x - y < bl.s) bl = { x, y, s: x - y };
  }
  const quad: Quad = [
    { x: tl.x / (w - 1), y: tl.y / (h - 1) },
    { x: tr.x / (w - 1), y: tr.y / (h - 1) },
    { x: br.x / (w - 1), y: br.y / (h - 1) },
    { x: bl.x / (w - 1), y: bl.y / (h - 1) },
  ];
  // If the paper fills the frame there is nothing to correct.
  const area = Math.abs(
    quad.reduce((s, p, i) => {
      const q = quad[(i + 1) % 4];
      return s + p.x * q.y - q.x * p.y;
    }, 0) / 2,
  );
  if (area > 0.97) return null;
  return quad;
}

export function canvasToBlob(c: HTMLCanvasElement, type = "image/jpeg", quality = 0.9): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode the image."))), type, quality),
  );
}
