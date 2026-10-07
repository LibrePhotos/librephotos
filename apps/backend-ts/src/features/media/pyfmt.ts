// Python/Django string behaviour the media views' headers depend on (port of
// lp_media::pyfmt): os.path.basename/splitext/dirname, urllib.parse.quote,
// iri_to_uri, and how Django turns a header value into bytes.

const WIN = process.platform === "win32";
const isSep = (c: string) => c === "/" || (WIN && c === "\\");

function lastSep(path: string): number {
  for (let i = path.length - 1; i >= 0; i--) if (isSep(path[i]!)) return i;
  return -1;
}

/** os.path.basename (ntpath on Windows: both separators). */
export function basename(path: string): string {
  return path.slice(lastSep(path) + 1);
}

/** os.path.dirname. */
export function dirname(path: string): string {
  const i = lastSep(path);
  if (i < 0) return "";
  let head = path.slice(0, i);
  let j = head.length;
  while (j > 0 && isSep(head[j - 1]!)) j--;
  head = head.slice(0, j);
  return head === "" || head.endsWith(":") ? path.slice(0, i + 1) : head;
}

/** The extension os.path.splitext reports (with its dot), or "". */
export function ext(path: string): string {
  const base = basename(path).replace(/^\.+/, "");
  const i = base.lastIndexOf(".");
  return i < 0 ? "" : base.slice(i);
}

/** Join a relative name onto a base like os.path.join / PathBuf::join (no normalization). */
export function pjoin(base: string, name: string): string {
  if (base === "" || isSep(base[base.length - 1]!)) return base + name;
  return base + (WIN ? "\\" : "/") + name;
}

const UNRESERVED = /[A-Za-z0-9_.\-~]/;
const enc = new TextEncoder();

/** urllib.parse.quote(s, safe=safe) on the UTF-8 bytes of s. */
export function quote(s: string, safe: string): string {
  let out = "";
  for (const b of enc.encode(s)) {
    const c = String.fromCharCode(b);
    if (b < 0x80 && (UNRESERVED.test(c) || safe.includes(c))) out += c;
    else out += "%" + b.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

/** django.utils.encoding.iri_to_uri. */
export const iriToUri = (iri: string) => quote(iri, "/#%[]=:;$&()+,!?*@'~");

/**
 * A header value the way Django emits it: latin-1 when the text fits (a JS
 * ByteString, sent byte for byte), else RFC 2047
 * (email.header.Header(value, "utf-8").encode()).
 */
export function headerValue(text: string): string {
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 0xff) return mimeEncodeUtf8(text);
  return text;
}

/** One encoded word, quoted-printable unless base64 is strictly shorter. */
function mimeEncodeUtf8(text: string): string {
  const bytes = enc.encode(text);
  const b64 = Buffer.from(bytes).toString("base64");
  let qp = "";
  for (const b of bytes) {
    const c = String.fromCharCode(b);
    if (b < 0x80 && /[A-Za-z0-9\-!*+/]/.test(c)) qp += c;
    else if (b === 0x20) qp += "_";
    else qp += "=" + b.toString(16).toUpperCase().padStart(2, "0");
  }
  return b64.length < qp.length ? `=?utf-8?b?${b64}?=` : `=?utf-8?q?${qp}?=`;
}

/** django.utils.http.content_disposition_header(False, filename). */
export function inlineDisposition(filename: string): string {
  const bytes = enc.encode(filename);
  const quotable = bytes.every((b) => b === 0x09 || b === 0x20 || (b >= 0x21 && b <= 0x7e));
  if (quotable) return `inline; filename="${filename.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  return `inline; filename*=utf-8''${quote(filename, "/")}`;
}

/** Python's str(float) for the values ffmpeg options take. */
export function pyFloat(x: number): string {
  return Number.isInteger(x) && Math.abs(x) < 1e16 ? x.toFixed(1) : String(x);
}
