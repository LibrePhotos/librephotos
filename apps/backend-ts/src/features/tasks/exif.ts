// The metadata reads the tasks need (face regions, GPS) with the exif
// sidecar's semantics (port of lp_tasks::exif over lp_exif's get_metadata):
// every existing XMP sidecar and the media file, later files overriding
// earlier ones; plain reads with pyexiftool's default `-G -n`, structured
// ones with `-struct` only. One `-stay_open` ExifTool per mode. No ExifTool
// installed reads as "no metadata" (null).
import { existsSync } from "node:fs";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { config } from "../../lib/config";

export class MetadataError extends Error {
  constructor(file: string, message: string) {
    super(`exif service could not read the metadata of ${file}: ${message}`);
  }
}

class NoExiftool extends Error {}

type Json = Record<string, unknown>;

class StayOpen {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private seq = 0;
  private buf = "";
  private chain: Promise<unknown> = Promise.resolve();
  private waiter: ((out: string) => void) | null = null;
  private failer: ((e: Error) => void) | null = null;
  private idle: ReturnType<typeof setTimeout> | null = null;

  constructor(private commonArgs: string[]) {}

  private start() {
    const exe = config.exiftool || "exiftool";
    const p = spawn(exe, ["-stay_open", "True", "-@", "-", "-common_args", ...this.commonArgs], { windowsHide: true });
    p.stdout.setEncoding("utf8");
    p.stdout.on("data", (d: string) => {
      this.buf += d;
      this.pump();
    });
    p.stderr.on("data", () => {});
    const dead = (e: Error) => {
      if (this.proc === p) this.proc = null;
      this.failer?.(e);
    };
    p.on("error", (e: NodeJS.ErrnoException) => dead(e.code === "ENOENT" ? new NoExiftool(e.message) : e));
    p.on("exit", () => dead(new Error("exiftool exited")));
    this.proc = p;
  }

  private pump() {
    const m = /\{ready(\d+)\}\r?\n?/.exec(this.buf);
    if (!m || !this.waiter) return;
    const out = this.buf.slice(0, m.index);
    this.buf = this.buf.slice(m.index + m[0].length);
    const w = this.waiter;
    this.waiter = null;
    this.failer = null;
    w(out);
  }

  /** One command (serialised per process). */
  execute(args: string[]): Promise<string> {
    if (args.some((a) => /[\r\n]/.test(a))) return Promise.reject(new Error("argument contains a line break"));
    const run = async () => {
      if (!this.proc) this.start();
      if (this.idle) clearTimeout(this.idle);
      const seq = ++this.seq;
      const out = await new Promise<string>((resolve, reject) => {
        this.waiter = resolve;
        this.failer = reject;
        this.proc!.stdin.write([...args, `-execute${seq}`, ""].join("\n"));
        this.pump();
      });
      // Stop an idle ExifTool after a while (the next stage may need none).
      this.idle = setTimeout(() => this.stop(), 30_000);
      return out;
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => undefined);
    return p;
  }

  stop() {
    const p = this.proc;
    this.proc = null;
    if (p) {
      try {
        p.stdin.write("-stay_open\nFalse\n");
        p.stdin.end();
      } catch {
        // already gone
      }
    }
  }
}

const plain = new StayOpen(["-G", "-n"]);
const structured = new StayOpen(["-struct"]);

export function stopExiftool() {
  plain.stop();
  structured.stop();
}

async function getTagsBatch(tags: string[], files: string[], struct: boolean): Promise<Json[]> {
  const out = await (struct ? structured : plain).execute(["-j", ...tags.map((t) => `-${t}`), ...files]);
  let parsed: unknown;
  try {
    parsed = JSON.parse(out.trim());
  } catch (e) {
    throw new MetadataError(files[0] ?? "", (e as Error).message);
  }
  if (!Array.isArray(parsed)) throw new MetadataError(files[0] ?? "", "exiftool answered without a list");
  return parsed.map((v) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {}));
}

function splitTag(tag: string): [string, string] {
  const i = tag.lastIndexOf(":");
  return i < 0 ? ["", tag.toLowerCase()] : [tag.slice(0, i).toLowerCase(), tag.slice(i + 1).toLowerCase()];
}
const groupMatches = (req: string, ret: string) => !req || !ret || req === ret || req.startsWith(ret + "-");
const nameMatches = (req: string, ret: string) => (req.endsWith("-*") ? ret.startsWith(req.slice(0, -1)) : req === ret);

/** The sidecar's `_attribute`: values in tag order and whether every returned key was claimed. */
function attribute(data: Json, tags: string[]): [unknown[], boolean] {
  const keys = Object.keys(data).filter((k) => k !== "SourceFile");
  const claimed = new Set<string>();
  const values = tags.map((tag) => {
    const [group, name] = splitTag(tag);
    let value: unknown = null;
    for (const key of keys) {
      const [kg, kn] = splitTag(key);
      if (nameMatches(name, kn) && groupMatches(group, kg)) {
        claimed.add(key);
        if (value === null) value = data[key] ?? null;
      }
    }
    return value;
  });
  return [values, claimed.size === keys.length];
}

async function getTag(tag: string, file: string, struct: boolean): Promise<unknown> {
  const [data] = await getTagsBatch([tag], [file], struct);
  if (!data) return null;
  const k = Object.keys(data).find((x) => x !== "SourceFile");
  return k === undefined ? null : data[k];
}

/** `get_sidecar_files_in_priority_order` + the media file, lowest priority first. */
function filesByReversePriority(media: string): string[] {
  const sep = Math.max(media.lastIndexOf("/"), media.lastIndexOf("\\")) + 1;
  const dot = media.lastIndexOf(".");
  const base = dot > sep && !/^\.+$/.test(media.slice(sep, dot + 1)) ? media.slice(0, dot) : media;
  const sidecars = [`${base}.xmp`, `${base}.XMP`, `${media}.xmp`, `${media}.XMP`].filter((f) => existsSync(f));
  return [...sidecars, media].reverse();
}

/**
 * `get_metadata(media, tags, try_sidecar=True, struct)`: one value per tag
 * (null when absent); null when ExifTool is not installed.
 */
export async function getTags(media: string, tags: string[], struct: boolean): Promise<unknown[] | null> {
  const files = filesByReversePriority(media);
  try {
    const perFile = await getTagsBatch(tags, files, struct);
    if (perFile.length !== files.length) {
      const out: unknown[] = [];
      for (const tag of tags) {
        let value: unknown = null;
        for (const f of files) {
          const v = await getTag(tag, f, struct);
          if (v !== null && v !== undefined) value = v;
        }
        out.push(value);
      }
      return out;
    }
    const values: unknown[] = tags.map(() => null);
    for (let i = 0; i < files.length; i++) {
      const [fileValues, complete] = attribute(perFile[i], tags);
      if (!complete) {
        for (let j = 0; j < tags.length; j++) if (fileValues[j] === null) fileValues[j] = await getTag(tags[j], files[i], struct);
      }
      fileValues.forEach((v, j) => {
        if (v !== null && v !== undefined) values[j] = v;
      });
    }
    return values;
  } catch (e) {
    if (e instanceof NoExiftool) return null;
    if (e instanceof MetadataError) throw new MetadataError(media, e.message.replace(/^.*?: /, ""));
    throw new MetadataError(media, (e as Error).message);
  }
}
