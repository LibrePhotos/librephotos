// In-process ExifTool (`exiftool -stay_open True -@ -`, common args -G -n
// like pyexiftool), the part of lp_exif the photo_edits area needs:
// api.metadata.reader.get_metadata (XMP sidecars override the media file),
// api.metadata.writer.write_metadata and read_orientation. The binary is
// LP_EXIFTOOL, else the one exiftool-vendored ships. No extra arguments
// (exiftool-vendored's task layer adds charset options, which would change
// the bytes written into files compared with Django and Rust).
// TODO(merge): unify with src/lib/exif.ts from the ingest port.
import path from "node:path";
import { config } from "~/lib/config";

type Json = Record<string, unknown>;

class Proc {
  private buf = "";
  private waiters: (() => void)[] = [];
  private closed = false;
  readonly proc: ReturnType<typeof Bun.spawn>;

  constructor(bin: string) {
    this.proc = Bun.spawn([bin, "-stay_open", "True", "-@", "-", "-common_args", "-G", "-n"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "ignore",
      windowsHide: true,
    });
    void this.pump();
  }

  private async pump() {
    const dec = new TextDecoder();
    try {
      for await (const chunk of this.proc.stdout as ReadableStream<Uint8Array>) {
        this.buf += dec.decode(chunk, { stream: true });
        this.wake();
      }
    } catch {
      /* the process went away */
    }
    this.closed = true;
    this.wake();
  }

  private wake() {
    const w = this.waiters;
    this.waiters = [];
    for (const f of w) f();
  }

  async execute(args: string[], seq: number): Promise<string> {
    const stdin = this.proc.stdin as import("bun").FileSink;
    stdin.write(args.map((a) => a + "\n").join("") + `-execute${seq}\n`);
    await stdin.flush();
    const sentinel = new RegExp(`(^|\\n)\\{ready${seq}\\}\\r?\\n`);
    for (;;) {
      const m = sentinel.exec(this.buf);
      if (m) {
        const out = this.buf.slice(0, m.index + (m[1] ? 1 : 0));
        this.buf = this.buf.slice(m.index + m[0].length);
        return out;
      }
      if (this.closed) throw new Error("exiftool closed its output");
      await new Promise<void>((r) => this.waiters.push(r));
    }
  }

  kill() {
    try {
      this.proc.kill();
    } catch {
      /* already gone */
    }
  }
}

const POOL_SIZE = 2;
const TIMEOUT_MS = 120_000;
const idle: Proc[] = [];
let busy = 0;
const queue: (() => void)[] = [];
let seq = 0;
let binPromise: Promise<string> | null = null;

function exiftoolBin(): Promise<string> {
  binPromise ??= config.exiftool
    ? Promise.resolve(config.exiftool)
    : import("exiftool-vendored").then((m) => m.exiftoolPath());
  return binPromise;
}

/** Run one command (the arguments before -execute) and return its stdout. */
export async function execute(args: string[]): Promise<string> {
  // Arguments go to the -@ - argfile one per line: a line break would smuggle in options.
  const bad = args.find((a) => /[\r\n]/.test(a));
  if (bad !== undefined) throw new Error(`exiftool argument contains a line break: ${JSON.stringify(bad)}`);
  if (busy >= POOL_SIZE) await new Promise<void>((r) => queue.push(r));
  busy++;
  let proc = idle.pop();
  try {
    proc ??= new Proc(await exiftoolBin());
    const p = proc;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const out = await Promise.race([
      p.execute(args, ++seq),
      new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error(`exiftool did not answer within ${TIMEOUT_MS} ms`)), TIMEOUT_MS);
      }),
    ]).finally(() => clearTimeout(timer));
    idle.push(p);
    return out;
  } catch (e) {
    proc?.kill();
    throw e;
  } finally {
    busy--;
    queue.shift()?.();
  }
}

async function executeJson(args: string[], file: string): Promise<Json[]> {
  const out = await execute(["-j", ...args]);
  let parsed: unknown;
  try {
    parsed = JSON.parse(out.trim());
  } catch (e) {
    throw new Error(`exif service could not read the metadata of ${file}: ${(e as Error).message}`);
  }
  if (!Array.isArray(parsed)) throw new Error(`exif service could not read the metadata of ${file}: exiftool answered without a list`);
  return parsed.map((v) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {}));
}

function getTagsBatch(tags: string[], files: string[]) {
  return executeJson([...tags.map((t) => `-${t}`), ...files], files[0] ?? "");
}

/** pyexiftool get_tag: the first value that is not SourceFile. */
async function getTag(tag: string, file: string): Promise<unknown> {
  const data = await getTagsBatch([tag], [file]);
  const d = data[0];
  if (!d) return undefined;
  for (const [k, v] of Object.entries(d)) if (k !== "SourceFile") return v;
  return undefined;
}

// --- attribution (service/exif/main.py _attribute) ----------------------

function splitTag(tag: string): [string, string] {
  const i = tag.lastIndexOf(":");
  return i < 0 ? ["", tag.toLowerCase()] : [tag.slice(0, i).toLowerCase(), tag.slice(i + 1).toLowerCase()];
}
const groupMatches = (req: string, ret: string) => !req || !ret || req === ret || req.startsWith(`${ret}-`);
const nameMatches = (req: string, ret: string) => (req.endsWith("-*") ? ret.startsWith(req.slice(0, -1)) : req === ret);

function attribute(data: Json, tags: string[]): [unknown[], boolean] {
  const keys = Object.keys(data)
    .filter((k) => k !== "SourceFile")
    .map((k) => [k, splitTag(k)] as const);
  const claimed = keys.map(() => false);
  const values = tags.map((tag) => {
    const [g, n] = splitTag(tag);
    let value: unknown = undefined;
    keys.forEach(([key, [kg, kn]], i) => {
      if (nameMatches(n, kn) && groupMatches(g, kg)) {
        claimed[i] = true;
        if (value === undefined) value = data[key];
      }
    });
    return value;
  });
  return [values, claimed.every(Boolean)];
}

/** Django's service/exif/tag_validation.py: a plain [Group:]Name. */
export const isSafeTag = (t: string) => t.length <= 128 && /^[A-Za-z0-9_][A-Za-z0-9_:*?#-]*$/.test(t);

/** os.path.splitext on the full path string. */
function splitext(p: string): [string, string] {
  const sep = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")) + 1;
  const name = p.slice(sep);
  const lead = name.length - name.replace(/^\.+/, "").length;
  const dot = name.slice(lead).lastIndexOf(".");
  if (dot < 0) return [p, ""];
  const at = sep + lead + dot;
  return [p.slice(0, at), p.slice(at)];
}

/** get_sidecar_files_in_priority_order: IMG.xmp, IMG.XMP, IMG.jpg.xmp, IMG.jpg.XMP */
export function sidecarFiles(media: string): string[] {
  const base = splitext(media)[0];
  return [`${base}.xmp`, `${base}.XMP`, `${media}.xmp`, `${media}.XMP`];
}

/** api.metadata.reader.get_metadata: one value per tag (undefined = absent), later files win. */
export async function getMetadata(media: string, tags: string[], trySidecar: boolean): Promise<unknown[]> {
  const safe = tags.filter(isSafeTag);
  const got = new Map<string, unknown>();
  if (safe.length) {
    let files = [media];
    if (trySidecar) {
      const existing: string[] = [];
      for (const f of sidecarFiles(media)) if (await Bun.file(f).exists()) existing.push(f);
      files = [...existing, media].reverse();
    }
    const vals = await highestPriorityValues(safe, files);
    safe.forEach((t, i) => got.set(t, vals[i]));
  }
  return tags.map((t) => got.get(t));
}

async function highestPriorityValues(tags: string[], files: string[]): Promise<unknown[]> {
  const perFile = await getTagsBatch(tags, files);
  if (perFile.length !== files.length) {
    const out: unknown[] = [];
    for (const tag of tags) {
      let v: unknown = undefined;
      for (const f of files) {
        const x = await getTag(tag, f);
        if (x !== undefined) v = x;
      }
      out.push(v);
    }
    return out;
  }
  const values: unknown[] = tags.map(() => undefined);
  for (let fi = 0; fi < files.length; fi++) {
    const [fileValues, complete] = attribute(perFile[fi], tags);
    if (!complete) {
      for (let i = 0; i < fileValues.length; i++) if (fileValues[i] === undefined) fileValues[i] = await getTag(tags[i], files[fi]);
    }
    fileValues.forEach((v, i) => {
      if (v !== undefined) values[i] = v;
    });
  }
  return values;
}

function pyStr(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === true) return "True";
  if (v === false) return "False";
  if (v === null || v === undefined) return "None";
  return String(v);
}

/**
 * api.metadata.writer.write_metadata: -TAG=value ... -overwrite_original
 * <file>, into the first sidecar name when useSidecar. A failed write is
 * reported on stdout, not raised (like PyExifTool).
 */
export async function writeMetadata(media: string, tags: [string, unknown][], useSidecar: boolean): Promise<string> {
  const target = useSidecar ? sidecarFiles(media)[0] : media;
  const args: string[] = [];
  for (const [tag, value] of tags) {
    if (Array.isArray(value)) for (const item of value) args.push(`-${tag}=${pyStr(item)}`);
    else args.push(`-${tag}=${pyStr(value)}`);
  }
  args.push("-overwrite_original", target);
  return execute(args);
}

/** read_orientation: the file's own EXIF Orientation (1 when absent), undefined when unreadable. */
export async function readOrientation(media: string): Promise<number | undefined> {
  try {
    const v = await getTag("EXIF:Orientation", media);
    if (v === undefined) return 1;
    return typeof v === "number" && Number.isInteger(v) ? v : undefined;
  } catch (e) {
    console.warn(`could not read the orientation of ${media}: ${e}`);
    return undefined;
  }
}

export const fileName = (p: string) => path.basename(p.replace(/\\/g, "/"));
