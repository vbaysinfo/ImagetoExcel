/** Helpers for A1-style cell references. */

export function colToIndex(col: string): number {
  let n = 0;
  for (const ch of col.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export function indexToCol(index: number): string {
  let s = "";
  let n = index;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function splitRef(ref: string): { col: string; row: number } {
  const m = ref.replace(/\$/g, "").match(/^([A-Za-z]{1,3})(\d+)$/);
  if (!m) throw new Error(`Invalid cell reference: ${ref}`);
  return { col: m[1].toUpperCase(), row: Number(m[2]) };
}

export function isColumnLetter(s: string): boolean {
  return /^[A-Z]{1,3}$/.test(s) && colToIndex(s) <= 16384;
}

/**
 * Shift the relative references of a formula, the way Excel does when a
 * formula is filled down/right (used to expand shared formulas and to write
 * formulas into rows added beyond the template).
 */
export function shiftFormula(formula: string, dRow: number, dCol: number): string {
  if (dRow === 0 && dCol === 0) return formula;
  let out = "";
  let i = 0;
  while (i < formula.length) {
    const ch = formula[i];
    // String literals are copied verbatim ("" escapes a quote).
    if (ch === '"') {
      let j = i + 1;
      while (j < formula.length) {
        if (formula[j] === '"') {
          if (formula[j + 1] === '"') j += 2;
          else break;
        } else j++;
      }
      out += formula.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    // Quoted sheet names: copy up to and including the closing quote.
    if (ch === "'") {
      const j = formula.indexOf("'", i + 1);
      const end = j === -1 ? formula.length : j + 1;
      out += formula.slice(i, end);
      i = end;
      continue;
    }
    const m = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)/.exec(formula.slice(i));
    const prev = i > 0 ? formula[i - 1] : "";
    if (m && !/[A-Za-z0-9_.]/.test(prev)) {
      const after = formula[i + m[0].length] ?? "";
      // Not a reference if it continues as an identifier or is a function name.
      if (!/[A-Za-z0-9_(]/.test(after)) {
        const [, colAbs, col, rowAbs, row] = m;
        const newCol = colAbs ? col.toUpperCase() : indexToCol(colToIndex(col) + dCol);
        const newRow = rowAbs ? Number(row) : Number(row) + dRow;
        out += `${colAbs}${newCol}${rowAbs}${newRow}`;
        i += m[0].length;
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
}
