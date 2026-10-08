/**
 * A small Excel formula evaluator.
 *
 * It lets the app reproduce the template's own formulas (instead of
 * hard-coding a calculation) for the live preview on the review screen and
 * for the cached values written into the generated workbook. Excel still
 * recalculates everything when the file is opened.
 *
 * Supported: numbers, strings, booleans, cell refs and ranges (same sheet),
 * + - * / ^ & = <> < > <= >=, unary minus, percent, and the functions below.
 * Anything else raises `UnsupportedFormulaError`, in which case the caller
 * leaves the value for Excel to compute.
 */
import { colToIndex, indexToCol, splitRef } from "./cellref";

export type CellValue = number | string | boolean | null;

export class UnsupportedFormulaError extends Error {}
class FormulaError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

type Token =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "bool"; v: boolean }
  | { t: "ref"; v: string }
  | { t: "range"; from: string; to: string }
  | { t: "fn"; v: string }
  | { t: "op"; v: string }
  | { t: "(" }
  | { t: ")" }
  | { t: "," };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const s = src.startsWith("=") ? src.slice(1) : src;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let v = "";
      while (j < s.length) {
        if (s[j] === '"') {
          if (s[j + 1] === '"') {
            v += '"';
            j += 2;
            continue;
          }
          break;
        }
        v += s[j++];
      }
      tokens.push({ t: "str", v });
      i = j + 1;
      continue;
    }
    const num = /^(\d+\.?\d*|\.\d+)(E[+-]?\d+)?/i.exec(s.slice(i));
    if (num) {
      tokens.push({ t: "num", v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const range = /^\$?([A-Za-z]{1,3})\$?(\d+):\$?([A-Za-z]{1,3})\$?(\d+)/.exec(s.slice(i));
    if (range) {
      tokens.push({ t: "range", from: `${range[1]}${range[2]}`, to: `${range[3]}${range[4]}` });
      i += range[0].length;
      continue;
    }
    const ident = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(s.slice(i));
    if (ident) {
      const word = ident[0];
      const after = s.slice(i + word.length).trimStart();
      if (after.startsWith("(")) {
        tokens.push({ t: "fn", v: word.toUpperCase() });
      } else if (/^(TRUE|FALSE)$/i.test(word)) {
        tokens.push({ t: "bool", v: word.toUpperCase() === "TRUE" });
      } else {
        const ref = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(word);
        if (!ref) throw new UnsupportedFormulaError(`Unsupported name: ${word}`);
        tokens.push({ t: "ref", v: `${ref[1].toUpperCase()}${ref[2]}` });
      }
      i += word.length;
      continue;
    }
    if (ch === "$") {
      // "$A$1" — strip the absolute markers and re-scan.
      const ref = /^\$?([A-Za-z]{1,3})\$?(\d+)/.exec(s.slice(i));
      if (!ref) throw new UnsupportedFormulaError(`Unexpected "$"`);
      const rest = s.slice(i + ref[0].length);
      if (rest.startsWith(":")) {
        const to = /^:\$?([A-Za-z]{1,3})\$?(\d+)/.exec(rest);
        if (!to) throw new UnsupportedFormulaError("Bad range");
        tokens.push({ t: "range", from: `${ref[1]}${ref[2]}`, to: `${to[1]}${to[2]}` });
        i += ref[0].length + to[0].length;
      } else {
        tokens.push({ t: "ref", v: `${ref[1].toUpperCase()}${ref[2]}` });
        i += ref[0].length;
      }
      continue;
    }
    const two = s.slice(i, i + 2);
    if (["<>", "<=", ">="].includes(two)) {
      tokens.push({ t: "op", v: two });
      i += 2;
      continue;
    }
    if ("+-*/^&=<>%".includes(ch)) {
      tokens.push({ t: "op", v: ch });
      i++;
      continue;
    }
    if (ch === "(") tokens.push({ t: "(" });
    else if (ch === ")") tokens.push({ t: ")" });
    else if (ch === "," || ch === ";") tokens.push({ t: "," });
    else throw new UnsupportedFormulaError(`Unsupported character: ${ch}`);
    i++;
  }
  return tokens;
}

type Node =
  | { k: "lit"; v: CellValue }
  | { k: "ref"; ref: string }
  | { k: "range"; from: string; to: string }
  | { k: "un"; op: string; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "pct"; a: Node }
  | { k: "call"; fn: string; args: Node[] };

const PRECEDENCE: Record<string, number> = {
  "=": 1, "<>": 1, "<": 1, ">": 1, "<=": 1, ">=": 1,
  "&": 2,
  "+": 3, "-": 3,
  "*": 4, "/": 4,
  "^": 5,
};

function parse(tokens: Token[]): Node {
  let pos = 0;
  const peek = () => tokens[pos];

  function primary(): Node {
    const tok = tokens[pos++];
    if (!tok) throw new UnsupportedFormulaError("Unexpected end of formula");
    switch (tok.t) {
      case "num":
      case "str":
      case "bool":
        return { k: "lit", v: tok.v };
      case "ref":
        return { k: "ref", ref: tok.v };
      case "range":
        return { k: "range", from: tok.from, to: tok.to };
      case "op":
        if (tok.v === "-" || tok.v === "+") return { k: "un", op: tok.v, a: unaryOperand() };
        throw new UnsupportedFormulaError(`Unexpected operator ${tok.v}`);
      case "(": {
        const e = expr(0);
        if (tokens[pos++]?.t !== ")") throw new UnsupportedFormulaError("Missing )");
        return e;
      }
      case "fn": {
        pos++; // "("
        const args: Node[] = [];
        if (peek()?.t === ")") {
          pos++;
          return { k: "call", fn: tok.v, args };
        }
        for (;;) {
          if (peek()?.t === "," || peek()?.t === ")") args.push({ k: "lit", v: null });
          else args.push(expr(0));
          const sep = tokens[pos++];
          if (sep?.t === ")") break;
          if (sep?.t !== ",") throw new UnsupportedFormulaError("Expected , or )");
        }
        return { k: "call", fn: tok.v, args };
      }
      default:
        throw new UnsupportedFormulaError("Unexpected token");
    }
  }

  function unaryOperand(): Node {
    let n = primary();
    while (peek()?.t === "op" && (peek() as { v: string }).v === "%") {
      pos++;
      n = { k: "pct", a: n };
    }
    return n;
  }

  function expr(minPrec: number): Node {
    let left = unaryOperand();
    for (;;) {
      const tok = peek();
      if (!tok || tok.t !== "op" || tok.v === "%") break;
      const prec = PRECEDENCE[tok.v];
      if (prec === undefined || prec < minPrec) break;
      pos++;
      const right = expr(tok.v === "^" ? prec : prec + 1);
      left = { k: "bin", op: tok.v, a: left, b: right };
    }
    return left;
  }

  const result = expr(0);
  if (pos !== tokens.length) throw new UnsupportedFormulaError("Unexpected trailing tokens");
  return result;
}

export interface EvalContext {
  /** Returns the value of a cell on the current sheet (evaluating formulas as needed). */
  getCell(col: string, row: number): CellValue;
}

function toNumber(v: CellValue): number {
  if (v === null || v === "") return 0;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  const n = Number(v);
  if (Number.isNaN(n)) throw new FormulaError("#VALUE!");
  return n;
}

function toText(v: CellValue): string {
  if (v === null) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return String(v);
}

function toBool(v: CellValue): boolean {
  if (typeof v === "boolean") return v;
  if (v === null || v === "") return false;
  if (typeof v === "number") return v !== 0;
  if (/^true$/i.test(v)) return true;
  if (/^false$/i.test(v)) return false;
  throw new FormulaError("#VALUE!");
}

function compare(a: CellValue, b: CellValue, op: string): boolean {
  // Blank cells compare equal to "" and to 0, like Excel.
  const norm = (x: CellValue, other: CellValue): CellValue => {
    if (x !== null) return x;
    if (typeof other === "number") return 0;
    if (typeof other === "boolean") return false;
    return "";
  };
  const x = norm(a, b);
  const y = norm(b, a);
  let c: number;
  if (typeof x === "string" && typeof y === "string") {
    const xl = x.toLowerCase();
    const yl = y.toLowerCase();
    c = xl < yl ? -1 : xl > yl ? 1 : 0;
  } else if (typeof x === typeof y) {
    c = toNumber(x) - toNumber(y);
  } else {
    // Excel orders numbers < text < booleans.
    const rank = (v: CellValue) => (typeof v === "number" ? 0 : typeof v === "string" ? 1 : 2);
    c = rank(x) - rank(y);
  }
  switch (op) {
    case "=": return c === 0;
    case "<>": return c !== 0;
    case "<": return c < 0;
    case ">": return c > 0;
    case "<=": return c <= 0;
    default: return c >= 0;
  }
}

function rangeValues(from: string, to: string, ctx: EvalContext): CellValue[] {
  const a = splitRef(from);
  const b = splitRef(to);
  const c1 = Math.min(colToIndex(a.col), colToIndex(b.col));
  const c2 = Math.max(colToIndex(a.col), colToIndex(b.col));
  const r1 = Math.min(a.row, b.row);
  const r2 = Math.max(a.row, b.row);
  const out: CellValue[] = [];
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) out.push(ctx.getCell(indexToCol(c), r));
  }
  return out;
}

function flatten(args: Node[], ctx: EvalContext): CellValue[] {
  const out: CellValue[] = [];
  for (const a of args) {
    if (a.k === "range") out.push(...rangeValues(a.from, a.to, ctx));
    else out.push(evaluate(a, ctx));
  }
  return out;
}

function numbersOf(values: CellValue[]): number[] {
  return values.filter((v): v is number => typeof v === "number");
}

function evaluate(node: Node, ctx: EvalContext): CellValue {
  switch (node.k) {
    case "lit":
      return node.v;
    case "ref": {
      const { col, row } = splitRef(node.ref);
      return ctx.getCell(col, row);
    }
    case "range":
      throw new UnsupportedFormulaError("Range used outside a function");
    case "un": {
      const v = toNumber(evaluate(node.a, ctx));
      return node.op === "-" ? -v : v;
    }
    case "pct":
      return toNumber(evaluate(node.a, ctx)) / 100;
    case "bin": {
      const a = evaluate(node.a, ctx);
      const b = evaluate(node.b, ctx);
      switch (node.op) {
        case "+": return toNumber(a) + toNumber(b);
        case "-": return toNumber(a) - toNumber(b);
        case "*": return toNumber(a) * toNumber(b);
        case "/": {
          const d = toNumber(b);
          if (d === 0) throw new FormulaError("#DIV/0!");
          return toNumber(a) / d;
        }
        case "^": return toNumber(a) ** toNumber(b);
        case "&": return toText(a) + toText(b);
        default: return compare(a, b, node.op);
      }
    }
    case "call":
      return callFunction(node.fn, node.args, ctx);
  }
}

function roundTo(n: number, digits: number, mode: "round" | "up" | "down"): number {
  const f = 10 ** digits;
  const x = n * f;
  const r = mode === "round" ? Math.sign(x) * Math.round(Math.abs(x) + 1e-9)
    : mode === "up" ? Math.sign(x) * Math.ceil(Math.abs(x) - 1e-9)
    : Math.sign(x) * Math.floor(Math.abs(x) + 1e-9);
  return r / f;
}

function callFunction(fn: string, args: Node[], ctx: EvalContext): CellValue {
  const arg = (i: number) => (args[i] ? evaluate(args[i], ctx) : null);
  switch (fn) {
    case "IF": {
      const cond = toBool(arg(0));
      if (cond) return args.length > 1 ? arg(1) : true;
      return args.length > 2 ? arg(2) : false;
    }
    case "IFERROR":
      try {
        return arg(0);
      } catch (e) {
        if (e instanceof FormulaError) return arg(1);
        throw e;
      }
    case "AND":
      return flatten(args, ctx).filter((v) => v !== null).every(toBool);
    case "OR":
      return flatten(args, ctx).filter((v) => v !== null).some(toBool);
    case "NOT":
      return !toBool(arg(0));
    case "ISBLANK":
      return arg(0) === null;
    case "ISNUMBER":
      return typeof arg(0) === "number";
    case "SUM":
      return numbersOf(flatten(args, ctx)).reduce((s, n) => s + n, 0);
    case "PRODUCT":
      return numbersOf(flatten(args, ctx)).reduce((s, n) => s * n, 1);
    case "MIN": {
      const n = numbersOf(flatten(args, ctx));
      return n.length ? Math.min(...n) : 0;
    }
    case "MAX": {
      const n = numbersOf(flatten(args, ctx));
      return n.length ? Math.max(...n) : 0;
    }
    case "AVERAGE": {
      const n = numbersOf(flatten(args, ctx));
      if (!n.length) throw new FormulaError("#DIV/0!");
      return n.reduce((s, x) => s + x, 0) / n.length;
    }
    case "COUNT":
      return numbersOf(flatten(args, ctx)).length;
    case "COUNTA":
      return flatten(args, ctx).filter((v) => v !== null && v !== "").length;
    case "ABS":
      return Math.abs(toNumber(arg(0)));
    case "SQRT":
      return Math.sqrt(toNumber(arg(0)));
    case "PI":
      return Math.PI;
    case "ROUND":
      return roundTo(toNumber(arg(0)), toNumber(arg(1)), "round");
    case "ROUNDUP":
      return roundTo(toNumber(arg(0)), toNumber(arg(1)), "up");
    case "ROUNDDOWN":
      return roundTo(toNumber(arg(0)), toNumber(arg(1)), "down");
    case "INT":
      return Math.floor(toNumber(arg(0)));
    case "CEILING": {
      const sig = args.length > 1 ? toNumber(arg(1)) : 1;
      return sig === 0 ? 0 : Math.ceil(toNumber(arg(0)) / sig) * sig;
    }
    case "FLOOR": {
      const sig = args.length > 1 ? toNumber(arg(1)) : 1;
      return sig === 0 ? 0 : Math.floor(toNumber(arg(0)) / sig) * sig;
    }
    case "CONCATENATE":
    case "CONCAT":
      return flatten(args, ctx).map(toText).join("");
    case "TEXT":
      return toText(arg(0));
    default:
      throw new UnsupportedFormulaError(`Unsupported function ${fn}`);
  }
}

const cache = new Map<string, Node>();

export function compileFormula(formula: string): Node {
  let node = cache.get(formula);
  if (!node) {
    node = parse(tokenize(formula));
    cache.set(formula, node);
  }
  return node;
}

export type EvalResult =
  | { ok: true; value: CellValue }
  | { ok: false; error: string; unsupported: boolean };

export function evaluateFormula(formula: string, ctx: EvalContext): EvalResult {
  try {
    return { ok: true, value: evaluate(compileFormula(formula), ctx) };
  } catch (e) {
    if (e instanceof FormulaError) return { ok: false, error: e.code, unsupported: false };
    if (e instanceof UnsupportedFormulaError) return { ok: false, error: e.message, unsupported: true };
    if (e instanceof Error && e.message === "#CIRCULAR") return { ok: false, error: "Circular reference", unsupported: true };
    throw e;
  }
}
