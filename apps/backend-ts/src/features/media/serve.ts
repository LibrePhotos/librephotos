// Response builders shared by the media routes (port of lp_media::serve):
// Django's empty status responses, X-Accel hand-offs, and direct file
// serving with a single byte range (api/http_range.py), confined to the
// roots the file may live in.
import { closeSync, openSync, readSync, realpathSync, statSync, type Stats } from "node:fs";
import path from "node:path";
import { mimeType } from "./mime";
import { basename, headerValue, inlineDisposition } from "./pyfmt";

const WIN = process.platform === "win32";
const DJANGO_DEFAULT_TYPE = "text/html; charset=utf-8";
/** Answers up to this size are read in one go; larger ones are streamed. */
const INLINE_READ_MAX = 1024 * 1024;

/**
 * Set by src/server.ts: its fetch wrapper hands FILE_BODY slices straight to
 * Bun.serve (sendfile with Content-Length) without going through Start, so
 * no size needs reading into memory here.
 */
let directFileBodies = false;
export function useDirectFileBodies() {
  directFileBodies = true;
}
const CHUNK = 256 * 1024;
/** Property a large file Response carries for server.ts (see serveFile). */
export const FILE_BODY = Symbol.for("librephotos.fileBody");

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

const errStatus = (e: unknown) => {
  const code = (e as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR" ? 404 : code === "EACCES" || code === "EPERM" ? 403 : 500;
};

/** Read length bytes at start (synchronous: Bun's async file reads are slow on Windows). */
function readAt(fd: number, start: number, length: number): Uint8Array<ArrayBuffer> {
  // Never from the shared pool: the body outlives this call.
  const buf = new Uint8Array(new ArrayBuffer(length));
  let got = 0;
  while (got < length) {
    const n = readSync(fd, buf, got, length - got, start + got);
    if (n <= 0) break;
    got += n;
  }
  return got === length ? buf : buf.subarray(0, got);
}

/**
 * _serve_file_direct + ranged_response. `head` sends the headers only.
 * Small answers are read in one go; larger ones stream in chunks from the
 * open descriptor. (Start's handler reads `.body`, which would turn a
 * Bun.file body into a slow plain stream, run a sliced one to EOF and drop
 * Content-Length.)
 */
export function serveFile(req: FileRequest, rangeHeader: string | null, head: boolean): Response {
  let st: Stats | undefined;
  try {
    st = statSync(req.path, { throwIfNoEntry: false });
  } catch (e) {
    return empty(errStatus(e));
  }
  if (!st) return empty(404);
  if (!confined(req.path, req.roots)) {
    console.warn(`media path outside its root; refused: ${req.path}`);
    return empty(404);
  }
  if (!st.isFile()) return empty(404);
  const size = st.size;
  const range = parseRange(rangeHeader, size);
  if (range.kind === "unsatisfiable") {
    return empty(416, { "Content-Range": `bytes */${size}`, "Accept-Ranges": "bytes" });
  }
  const contentType = req.contentType ?? mimeType(req.path);
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
  if (directFileBodies) {
    const res = new Response(null, { status, headers });
    (res as unknown as Record<symbol, Blob>)[FILE_BODY] = Bun.file(req.path).slice(start, start + length);
    return res;
  }
  let fd: number;
  try {
    fd = openSync(req.path, "r");
  } catch (e) {
    return empty(errStatus(e));
  }
  if (length <= INLINE_READ_MAX) {
    try {
      return new Response(readAt(fd, start, length), { status, headers });
    } catch (e) {
      return empty(errStatus(e));
    } finally {
      closeSync(fd);
    }
  }
  const res = new Response(fdStream(fd, start, length), { status, headers });
  // server.ts swaps in this file slice (Bun keeps Content-Length for it and
  // sends it efficiently); the chunked stream is the fallback without it.
  (res as unknown as Record<symbol, Blob>)[FILE_BODY] = Bun.file(req.path).slice(start, start + length);
  return res;
}

/** A Bun direct ReadableStream over part of an open file (Bun keeps Content-Length for these); closes fd. */
function fdStream(fd: number, start: number, length: number): ReadableStream<Uint8Array> {
  let closed = false;
  const close = () => {
    if (!closed) {
      closed = true;
      closeSync(fd);
    }
  };
  return new ReadableStream({
    type: "direct",
    async pull(controller: { write(chunk: Uint8Array): unknown; flush(): unknown; close(): void }) {
      try {
        let pos = 0;
        while (pos < length && !closed) {
          const chunk = readAt(fd, start + pos, Math.min(CHUNK, length - pos));
          if (chunk.length === 0) break;
          pos += chunk.length;
          controller.write(chunk);
          await controller.flush();
        }
      } finally {
        close();
      }
      controller.close();
    },
    cancel: close,
  } as unknown as UnderlyingDefaultSource<Uint8Array>);
}
