// ExifTool pool (port of lp-exif): `exiftool -stay_open` processes through
// exiftool-vendored's batch-cluster, LP_EXIFTOOL as the binary. Two lanes
// like the Django exif sidecar: plain commands run with `-G -n`
// (pyexiftool's default common args), `structured` ones with `-struct`.
// getMetadata is `api/metadata/reader.py` get_metadata + the sidecar's
// batching/attribution, with a small cache so one scan reads each photo once.
// Output is parsed with parseExifJson, which keeps Python's int/float split.
import { statSync } from "node:fs";
import type { ExifTool } from "exiftool-vendored";
import { loadExiftool } from "./native";
import { config } from "./config";
import { parseExifJson, type PyValue } from "../features/ingest/pyfmt";

type Values = Map<string, PyValue | null>;
type ExifObj = Record<string, PyValue>;

type Lib = Awaited<ReturnType<typeof loadExiftool>>;
let rawTask: ((args: string[]) => InstanceType<Lib["ExifToolTask"]>) | null = null;

/** One command's stdout, whatever ExifTool printed to stderr (pyexiftool ignores it). */
function makeRawTaskFactory(lib: Lib) {
  class RawTask extends lib.ExifToolTask<string> {
    protected parse(input: string): string {
      return input;
    }
  }
  return (args: string[]) => new RawTask(args);
}

const COMMAND_TIMEOUT_MS = 120_000;
const CACHE_CAPACITY = 20_000;
const envInt = (k: string) => {
  const v = Number(process.env[k]);
  return Number.isFinite(v) && process.env[k] !== "" ? v : undefined;
};

function makeTool(lib: Lib, procs: number): ExifTool {
  return new lib.ExifTool({
    ...(config.exiftool ? { exiftoolPath: config.exiftool } : {}),
    maxProcs: procs,
    maxTasksPerProcess: 1_000_000,
    taskTimeoutMillis: COMMAND_TIMEOUT_MS,
    taskRetries: 0,
    useMWG: false,
    // Stop processes idle this long (LP_EXIF_IDLE_SECS, default 15; 0 = keep).
    maxIdleMsPerProcess: (envInt("LP_EXIF_IDLE_SECS") ?? 15) * 1000 || undefined,
  } as never);
}

export class ExifError extends Error {}

/** Whether `tag` is a plain `[Group:]Name` (Django's tag_validation, line breaks refused). */
export const isSafeTag = (tag: string) => tag.length <= 128 && /^[A-Za-z0-9_][A-Za-z0-9_:*?#-]{0,127}$/.test(tag) && !/[\r\n]/.test(tag);

/** get_sidecar_files_in_priority_order: IMG.xmp, IMG.XMP, IMG.jpg.xmp, IMG.jpg.XMP. */
export function sidecarFilesInPriorityOrder(media: string): string[] {
  const sep = Math.max(media.lastIndexOf("/"), media.lastIndexOf("\\")) + 1;
  const name = media.slice(sep);
  let lead = 0;
  while (lead < name.length && name[lead] === ".") lead++;
  const i = name.lastIndexOf(".");
  const base = i < lead ? media : media.slice(0, sep + i);
  return [`${base}.xmp`, `${base}.XMP`, `${media}.xmp`, `${media}.XMP`];
}

const fileExists = (p: string) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/** The files to read, lowest priority first (media file, then sidecars least to most preferred). */
export function existingMetadataFilesReversed(media: string, trySidecar: boolean): string[] {
  if (!trySidecar) return [media];
  const files = sidecarFilesInPriorityOrder(media).filter(fileExists);
  files.push(media);
  return files.reverse();
}

function stamp(p: string): string {
  try {
    const s = statSync(p);
    return `${p}|${s.mtimeMs}|${s.size}`;
  } catch {
    return `${p}||0`;
  }
}

// ---- attribution (service/exif/main.py _attribute) -------------------------

function splitTag(tag: string): [string, string] {
  const i = tag.lastIndexOf(":");
  return i >= 0 ? [tag.slice(0, i).toLowerCase(), tag.slice(i + 1).toLowerCase()] : ["", tag.toLowerCase()];
}

/** ExifTool reports the family 0 group ("XMP") even when "XMP-dc" was asked for. */
const groupMatches = (req: string, got: string) => req === "" || got === "" || req === got || req.startsWith(`${got}-`);
/** "Description-*" asks for every language entry of a lang-alt tag. */
const nameMatches = (req: string, got: string) => (req.endsWith("-*") ? got.startsWith(req.slice(0, -1)) : req === got);

/** Values in tag order (undefined = unresolved) and whether every returned key was claimed. */
export function attribute(data: ExifObj, tags: string[]): [(PyValue | undefined)[], boolean] {
  const keys = Object.keys(data).filter((k) => k !== "SourceFile").map((k) => [k, splitTag(k)] as const);
  const claimed = new Array(keys.length).fill(false);
  const values = tags.map((tag) => {
    const [group, name] = splitTag(tag);
    let value: PyValue | undefined;
    keys.forEach(([key, [kg, kn]], i) => {
      if (nameMatches(name, kn) && groupMatches(group, kg)) {
        claimed[i] = true;
        if (value === undefined) value = data[key];
      }
    });
    return value;
  });
  return [values, claimed.every(Boolean)];
}

const firstValue = (data: ExifObj): PyValue | undefined => {
  for (const [k, v] of Object.entries(data)) if (k !== "SourceFile") return v;
  return undefined;
};

/** Python str() for what ends up in `-TAG=value`. */
function pyStr(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === true) return "True";
  if (v === false) return "False";
  if (v === null || v === undefined) return "None";
  return JSON.stringify(v);
}

export class ExifPool {
  private plain: ExifTool | null = null;
  private structured: ExifTool | null = null;
  private cache = new Map<string, { stamps: string; values: Values }>();
  constructor(readonly poolSize: number) {}

  private async tool(structured: boolean): Promise<ExifTool> {
    const lib = await loadExiftool();
    rawTask ??= makeRawTaskFactory(lib);
    if (structured) return (this.structured ??= makeTool(lib, Math.min(2, this.poolSize)));
    return (this.plain ??= makeTool(lib, this.poolSize));
  }

  /** Run one command (the arguments before -execute) and return its stdout. */
  async execute(structured: boolean, args: string[]): Promise<string> {
    // One argument per argfile line: a line break would smuggle in options.
    const bad = args.find((a) => /[\r\n]/.test(a));
    if (bad !== undefined) throw new ExifError(`exiftool argument contains a line break: ${JSON.stringify(bad)}`);
    const common = structured ? ["-struct"] : ["-G", "-n"];
    const tool = await this.tool(structured);
    return tool.enqueueTask(() => rawTask!([...common, ...args]) as never, false) as Promise<string>;
  }

  /** pyexiftool execute_json: `-j` + args; an empty answer is an error like json.loads(""). */
  private async executeJson(structured: boolean, args: string[], label: string): Promise<ExifObj[]> {
    const out = await this.execute(structured, ["-j", ...args]);
    let parsed: unknown;
    try {
      parsed = parseExifJson(out.trim());
    } catch (e) {
      throw new ExifError(`exif service could not read the metadata of ${label}: ${(e as Error).message}`);
    }
    if (!Array.isArray(parsed)) throw new ExifError(`exif service could not read the metadata of ${label}: exiftool answered without a list`);
    return parsed.map((v) => (v && typeof v === "object" && !Array.isArray(v) ? (v as ExifObj) : {}));
  }

  /** pyexiftool get_tags_batch. */
  getTagsBatch(tags: string[], files: string[], structured: boolean): Promise<ExifObj[]> {
    return this.executeJson(structured, [...tags.map((t) => `-${t}`), ...files], files[0] ?? "");
  }

  async getTag(tag: string, file: string, structured: boolean): Promise<PyValue | undefined> {
    const data = await this.getTagsBatch([tag], [file], structured);
    return data[0] ? firstValue(data[0]) : undefined;
  }

  /** The sidecar's highest_priority_values: later files override earlier ones. */
  private async highestPriorityValues(tags: string[], files: string[], structured: boolean): Promise<(PyValue | undefined)[]> {
    const perFile = await this.getTagsBatch(tags, files, structured);
    const values: (PyValue | undefined)[] = new Array(tags.length).fill(undefined);
    if (perFile.length !== files.length) {
      for (let i = 0; i < tags.length; i++) {
        for (const f of files) {
          const v = await this.getTag(tags[i], f, structured);
          if (v !== undefined) values[i] = v;
        }
      }
      return values;
    }
    for (let fi = 0; fi < files.length; fi++) {
      const [fileValues, complete] = attribute(perFile[fi], tags);
      if (!complete) {
        for (let i = 0; i < tags.length; i++) {
          if (fileValues[i] === undefined) fileValues[i] = await this.getTag(tags[i], files[fi], structured);
        }
      }
      fileValues.forEach((v, i) => {
        if (v !== undefined) values[i] = v;
      });
    }
    return values;
  }

  /** get_metadata: one value per tag (null = absent), XMP sidecars overriding the media file. */
  async getMetadata(media: string, tags: string[], trySidecar: boolean, structured: boolean): Promise<(PyValue | null)[]> {
    const safe = tags.filter(isSafeTag);
    const got = await this.getSafeMetadata(media, safe, trySidecar, structured);
    let k = 0;
    return tags.map((t) => (isSafeTag(t) ? got[k++] : null));
  }

  private async getSafeMetadata(media: string, tags: string[], trySidecar: boolean, structured: boolean): Promise<(PyValue | null)[]> {
    if (!tags.length) return [];
    const files = existingMetadataFilesReversed(media, trySidecar);
    const stamps = files.map(stamp).join("\n");
    const key = `${media}\n${trySidecar}\n${structured}`;
    let entry = this.cache.get(key);
    if (entry && entry.stamps !== stamps) entry = undefined;
    const missing = entry ? tags.filter((t) => !entry!.values.has(t)) : tags;
    if (missing.length) {
      let fetched: (PyValue | undefined)[];
      try {
        fetched = await this.highestPriorityValues(missing, files, structured);
      } catch (e) {
        const detail = e instanceof ExifError ? e.message.replace(/^exif service could not read the metadata of .*?: /, "") : String((e as Error)?.message ?? e);
        throw new ExifError(`exif service could not read the metadata of ${media}: ${detail}`);
      }
      if (this.cache.size >= CACHE_CAPACITY) this.cache.clear();
      entry = this.cache.get(key);
      if (!entry || entry.stamps !== stamps) {
        entry = { stamps, values: new Map() };
        this.cache.set(key, entry);
      }
      missing.forEach((t, i) => entry!.values.set(t, fetched[i] ?? null));
    }
    return tags.map((t) => entry!.values.get(t) ?? null);
  }

  /** Forget cached tags of every photo whose files include `path`. */
  invalidate(p: string) {
    for (const [k, e] of this.cache) if (k.startsWith(`${p}\n`) || e.stamps.split("\n").some((s) => s.startsWith(`${p}|`))) this.cache.delete(k);
  }

  /** api.metadata.writer.write_metadata: `-TAG=value ... -overwrite_original <file>`. */
  async writeMetadata(media: string, tags: [string, unknown][], useSidecar: boolean): Promise<string> {
    const target = useSidecar ? sidecarFilesInPriorityOrder(media)[0] : media;
    const args: string[] = [];
    for (const [tag, value] of tags) {
      if (Array.isArray(value)) for (const item of value) args.push(`-${tag}=${pyStr(item)}`);
      else args.push(`-${tag}=${pyStr(value)}`);
    }
    args.push("-overwrite_original", target);
    const out = await this.execute(false, args);
    this.invalidate(media);
    this.invalidate(target);
    return out;
  }

  /** read_orientation: the media file's own EXIF Orientation (1 when absent), null when unreadable. */
  async readOrientation(media: string): Promise<number | null> {
    try {
      const v = await this.getTag("EXIF:Orientation", media, false);
      if (v === undefined) return 1;
      return typeof v === "number" ? v : null;
    } catch (e) {
      console.warn(`could not read the orientation of ${media}: ${e}`);
      return null;
    }
  }

  /** Stop every process (the next command starts fresh ones). */
  async shutdown() {
    const tools = [this.plain, this.structured];
    this.plain = this.structured = null;
    await Promise.all(tools.map((t) => t?.end(true).catch(() => {})));
  }
}

/** The process-wide pool (LP_EXIF_POOL processes per lane, default min(2, cores)). */
export const exif = new ExifPool(Math.max(1, envInt("LP_EXIF_POOL") ?? Math.min(2, navigator.hardwareConcurrency || 2)));
