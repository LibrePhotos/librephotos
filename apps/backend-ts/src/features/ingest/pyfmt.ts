// Python value semantics for what ExifTool returns (port of lp-ingest
// pyfmt.rs): Django stores `str(value)` of some tags (video_length,
// date_taken_subsec, shutter speed fractions) and writes reprs into job
// errors, so ints and floats must stay apart. ExifTool's JSON is parsed with
// parseExifJson: a number written with a '.' or an exponent becomes a
// PyFloat (Python's json gives a float), an integer stays a JS number (or a
// bigint beyond 2^53).

/** A JSON number Python's json module would decode as a float. */
export class PyFloat {
  constructor(readonly v: number) {}
  valueOf() {
    return this.v;
  }
  toJSON() {
    return this.v;
  }
}

export type PyValue = null | boolean | number | bigint | PyFloat | string | PyValue[] | { [k: string]: PyValue };

/** JSON.parse keeping Python's int/float split (needs the reviver's source text). */
export function parseExifJson(text: string): unknown {
  return JSON.parse(text, function (_key, value, ctx?: { source?: string }) {
    if (typeof value !== "number" || !ctx?.source) return value;
    const src = ctx.source;
    if (/[.eE]/.test(src)) return new PyFloat(value);
    if (!Number.isSafeInteger(value)) return BigInt(src);
    return value;
  } as (this: unknown, key: string, value: unknown) => unknown);
}

/** repr(float): shortest round-trip digits in Python's layout. */
export function floatRepr(x: number): string {
  if (Number.isNaN(x)) return "nan";
  if (!Number.isFinite(x)) return x > 0 ? "inf" : "-inf";
  if (x === 0) return Object.is(x, -0) ? "-0.0" : "0.0";
  const [mant, expStr] = Math.abs(x).toExponential().split("e");
  const exp = Number(expStr);
  const digits = mant.replace(".", "");
  const sign = x < 0 ? "-" : "";
  if (exp < -4 || exp >= 16) {
    const m = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
    return `${sign}${m}e${exp < 0 ? "-" : "+"}${String(Math.abs(exp)).padStart(2, "0")}`;
  }
  const point = exp + 1;
  let s: string;
  if (point <= 0) s = `0.${"0".repeat(-point)}${digits}`;
  else if (point >= digits.length) s = `${digits}${"0".repeat(point - digits.length)}.0`;
  else s = `${digits.slice(0, point)}.${digits.slice(point)}`;
  return sign + s;
}

/** repr(str). */
export function strRepr(s: string): string {
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = quote;
  for (const c of s) {
    const cp = c.codePointAt(0)!;
    if (c === "\\") out += "\\\\";
    else if (c === "\n") out += "\\n";
    else if (c === "\r") out += "\\r";
    else if (c === "\t") out += "\\t";
    else if (c === quote) out += "\\" + c;
    else if (cp < 0x20 || cp === 0x7f) out += "\\x" + cp.toString(16).padStart(2, "0");
    else out += c;
  }
  return out + quote;
}

export const listRepr = (items: string[]) => `[${items.map(strRepr).join(", ")}]`;

export function valueRepr(v: unknown): string {
  if (typeof v === "string") return strRepr(v);
  if (Array.isArray(v)) return `[${v.map(valueRepr).join(", ")}]`;
  if (v && typeof v === "object" && !(v instanceof PyFloat)) {
    return `{${Object.entries(v).map(([k, x]) => `${strRepr(k)}: ${valueRepr(x)}`).join(", ")}}`;
  }
  return valueStr(v);
}

/** str(value) of a JSON-decoded value. */
export function valueStr(v: unknown): string {
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (v instanceof PyFloat) return floatRepr(v.v);
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : floatRepr(v);
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "string") return v;
  return valueRepr(v);
}

/** isinstance(value, numbers.Number) (bools count). */
export const isNumber = (v: unknown): boolean =>
  typeof v === "number" || typeof v === "bigint" || typeof v === "boolean" || v instanceof PyFloat;

export function numberOf(v: unknown): number | null {
  if (v instanceof PyFloat) return v.v;
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "boolean") return v ? 1 : 0;
  return null;
}

/** Python truthiness. */
export function truthy(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (v instanceof PyFloat) return v.v !== 0;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "bigint") return v !== 0n;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return true;
}

/** int(value) of a number (truncating floats). */
export function asInt(v: unknown): number | null {
  const n = numberOf(v);
  return n === null || !Number.isFinite(n) ? null : Math.trunc(n);
}

export const asFloat = (v: unknown): number | null => numberOf(v);

/** str(Fraction(x).limit_denominator(maxDen)). */
export function fractionLimited(v: unknown, maxDen: bigint): string | null {
  let num: bigint, den: bigint;
  if (typeof v === "boolean") [num, den] = [v ? 1n : 0n, 1n];
  else if (typeof v === "bigint") [num, den] = [v, 1n];
  else if (typeof v === "number" && Number.isInteger(v)) [num, den] = [BigInt(v), 1n];
  else {
    const n = numberOf(v);
    if (n === null) return null;
    const r = floatRatio(n);
    if (!r) return null;
    [num, den] = r;
  }
  const [p, q] = limitDenominator(num, den, maxDen);
  return q === 1n ? p.toString() : `${p}/${q}`;
}

/** float.as_integer_ratio(). */
function floatRatio(x: number): [bigint, bigint] | null {
  if (!Number.isFinite(x)) return null;
  if (x === 0) return [0n, 1n];
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const bits = buf.getBigUint64(0);
  const neg = bits >> 63n === 1n;
  const exp = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  let m = exp === 0 ? frac : frac | (1n << 52n);
  let e = exp === 0 ? -1074 : exp - 1075;
  while ((m & 1n) === 0n && e < 0) {
    m >>= 1n;
    e++;
  }
  const [n, d] = e >= 0 ? [m << BigInt(e), 1n] : [m, 1n << BigInt(-e)];
  return [neg ? -n : n, d];
}

const floorDiv = (a: bigint, b: bigint) => {
  const q = a / b;
  return (a % b !== 0n && (a < 0n) !== (b < 0n)) ? q - 1n : q;
};

/** Fraction.limit_denominator (CPython). */
function limitDenominator(n0: bigint, d0: bigint, maxDen: bigint): [bigint, bigint] {
  if (d0 <= maxDen) return [n0, d0];
  let [p0, q0, p1, q1] = [0n, 1n, 1n, 0n];
  let [n, d] = [n0, d0];
  for (;;) {
    const a = floorDiv(n, d);
    const q2 = q0 + a * q1;
    if (q2 > maxDen) break;
    [p0, q0, p1, q1] = [p1, q1, p0 + a * p1, q2];
    [n, d] = [d, n - a * d];
  }
  const k = floorDiv(maxDen - q0, q1);
  return 2n * d * (q0 + k * q1) <= d0 ? [p1, q1] : [p0 + k * p1, q0 + k * q1];
}

/** round(x, 2) with CPython's exact half-even rounding. */
export function pyRound2(x: number): number {
  if (!Number.isFinite(x)) return x;
  // Exact ties at 2 digits are the odd multiples of 1/8 (x*100 is exact then).
  const scaled = x * 100;
  if (Number.isInteger(x * 8) && Math.abs(scaled - Math.trunc(scaled)) === 0.5) {
    const lo = Math.floor(scaled);
    return (lo % 2 === 0 ? lo : lo + 1) / 100;
  }
  return Number(x.toFixed(2));
}
