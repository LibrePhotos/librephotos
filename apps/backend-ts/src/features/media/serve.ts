// Response builders shared by the media routes (port of lp_media::serve):
// Django's empty status responses, X-Accel hand-offs, and direct file
// serving with a single byte range (api/http_range.py), confined to the
// roots the file may live in. Files are streamed by Bun (Bun.file bodies),
// never buffered.
import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { mimeType } from "./mime";
import { basename, headerValue, inlineDisposition } from "./pyfmt";

const WIN = process.platform === "win32";
const DJANGO_DEFAULT_TYPE = "text/html; charset=utf-8";
/** Ranges up to this size are read in one go; larger ones are streamed. */
const INLINE_READ_MAX = 1024 * 1024;

/** Django's HttpResponse(status=...): no body, the default content type. */
export function empty(status: number, extra?: Record<string, string>): Response {
  return new Response(null, {
    status,
    headers: { "Content-Type": DJANGO_DEFAULT_TYPE, "Content-Length": "0", ...extra },
  });
}

/**
 * _forbidden_unauthenticated: a 403 marked as a missing session, so the
 * frontend can tell it from a web server refusing to read the file.
 */
export const forbiddenUnauthenticated = () => empty(403, { "X-Media-Error": "authentication" });

/** _refuse: anonymous callers are asked to sign in, everyone else gets a 404. */
export const refuse = (signedIn: boolean) => (signedIn ? empty(404) : forbiddenUnauthenticated());

/** An empty 200 carrying Content-Type and X-Accel-Redirect for nginx. */
export function xAccel(contentType: string, target: string): Response {
  return empty(200, { "Content-Type": headerValue(contentType), "X-Accel-Redirect": headerValue(target) });
}

/** A file to serve directly and the roots it must resolve inside of. */
export interface FileRequest {
  /** The path as Django would open it (its basename names the download). */
  path: string;
  /** The file must lie under one of these. */
  roots: string[];
  /** undefined = sniff it (api.mime.mime_type). */
  contentType?: string;
}

export const fileRequest = (p: string, root: string, contentType?: string): FileRequest => ({
  path: p,
  roots: [root],
  contentType,
});

type Range = { kind: "whole" } | { kind: "part"; start: number; end: number } | { kind: "unsatisfiable" };
const WHOLE: Range = { kind: "whole" };

function digits(s: string): number | null | undefined {
  if (s === "") return null;
  if (!/^[0-9]+$/.test(s)) return undefined;
  return Number(s);
}

/** parse_byte_range: one bytes=a-b range, anything else = whole file. */
export function parseRange(header: string | null, size: number): Range {
  if (header === null || size === 0) return WHOLE;
  const t = header.trim();
  if (!t.startsWith("bytes=")) return WHOLE;
  const spec = t.slice(6);
  const dash = spec.indexOf("-");
  if (dash < 0) return WHOLE;
  const first = digits(spec.slice(0, dash));
  const last = digits(spec.slice(dash + 1));
  if (first === undefined || last === undefined) return WHOLE;
  if (first === null) {
    if (last === null) return WHOLE;
    const length = Math.min(last, size);
    return length === 0 ? { kind: "unsatisfiable" } : { kind: "part", start: size - length, end: size - 1 };
  }
  if (first >= size) return { kind: "unsatisfiable" };
  const end = last === null ? size - 1 : Math.min(last, size - 1);
  return end < first ? { kind: "unsatisfiable" } : { kind: "part", start: first, end };
}

/**
 * `p` made absolute, symlinks left alone; on Windows also case-folded with
 * one separator style. null for a path with `..` in it: behind a link `..`
 * climbs from the link's target, so it cannot be resolved as text.
 */
function lexical(p: string): string | null {
  if (p.split(WIN ? /[\\/]/ : /\//).includes("..")) return null;
  let abs = path.resolve(p);
  if (WIN) {
    abs = abs.replace(/\//g, "\\").toLowerCase();
    if (abs.startsWith("\\\\?\\")) abs = abs.slice(4);
  }
  return abs;
}

function under(p: string, root: string): boolean {
  if (p === root) return true;
  return p.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
}

function real(p: string): string | null {
  try {
    return realpathSync.native(p);
  } catch {
    return null;
  }
}

/**
 * Whether `p` lies under one of `roots`: inside a root as written (no
 * `..`), or after resolving every link on both sides (the scanner follows
 * symlinks, and thumbnail or library folders may be links to other disks).
 */
export function confined(p: string, roots: string[]): boolean {
  const lp = lexical(p);
  if (lp !== null) {
    for (const r of roots) {
      const lr = lexical(r);
      if (lr !== null && under(lp, lr)) return true;
    }
  }
  const rp = real(p);
  if (rp === null) return false;
  for (const r of roots) {
    const rr = real(r);
    if (rr !== null && under(rp, rr)) return true;
  }
  return false;
}

/** _serve_file_direct + ranged_response. `head` sends the headers only. */
export async function serveFile(req: FileRequest, rangeHeader: string | null, head: boolean): Promise<Response> {
  if (!existsSync(req.path)) return empty(404);
  if (!confined(req.path, req.roots)) {
    console.warn(`media path outside its root; refused: ${req.path}`);
    return empty(404);
  }
  let size: number;
  try {
    const st = statSync(req.path);
    if (!st.isFile()) return empty(404);
    size = st.size;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return empty(code === "ENOENT" ? 404 : code === "EACCES" || code === "EPERM" ? 403 : 500);
  }
  const contentType = req.contentType ?? mimeType(req.path);
  const range = parseRange(rangeHeader, size);
  if (range.kind === "unsatisfiable") {
    return empty(416, { "Content-Range": `bytes */${size}`, "Accept-Ranges": "bytes" });
  }
  const headers: Record<string, string> = { "Content-Type": headerValue(contentType), "Accept-Ranges": "bytes" };
  let status = 200;
  let start = 0;
  let length = size;
  if (range.kind === "part") {
    status = 206;
    start = range.start;
    length = range.end - range.start + 1;
    headers["Content-Range"] = `bytes ${start}-${range.end}/${size}`;
  } else {
    headers["Content-Disposition"] = headerValue(inlineDisposition(basename(req.path)));
  }
  headers["Content-Length"] = String(length);
  if (head) return new Response(null, { status, headers });
  const file = Bun.file(req.path);
  if (range.kind === "whole") return new Response(file, { status, headers });
  // A sliced Bun.file's `.body` (which Start's handler reads) runs to EOF,
  // and a plain stream body loses Content-Length: small ranges are read
  // whole, large ones streamed through a direct stream (which keeps it).
  const slice = file.slice(start, start + length);
  if (length <= INLINE_READ_MAX) return new Response(await slice.bytes(), { status, headers });
  return new Response(directStream(slice), { status, headers });
}

/** A Bun direct ReadableStream over a blob (Bun keeps the Content-Length header for these). */
function directStream(blob: Blob): ReadableStream<Uint8Array> {
  return new ReadableStream({
    type: "direct",
    async pull(controller: { write(chunk: Uint8Array): unknown; close(): void }) {
      const reader = blob.stream().getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        await controller.write(value);
      }
      controller.close();
    },
  } as unknown as UnderlyingDefaultSource<Uint8Array>);
}
