// scan_photos (port of lp-ingest scan.rs; api/directory_watcher/scan_jobs.py):
// walk, group, decide what changed, process the groups in-process with
// bounded concurrency (LP_SCAN_CONCURRENCY), finish the LongRunningJob
// exactly once, then the follow-ups: missing-file check, variant repair and
// the ML jobs.
import { statSync } from "node:fs";
import { config } from "../../lib/config";
import { client } from "../../lib/db";
import { exif, sidecarFilesInPriorityOrder } from "../../lib/exif";
import { enqueue, JobType, lrjFail, lrjIsCancelled } from "../../lib/jobs";
import { siteSettings } from "../../lib/settings";
import * as db from "./db";
import { begin } from "./db";
import * as fsu from "./fsutil";
import { aspectOf, handleFileGroup, loadOwner, type Owner } from "./pipeline";
import { ensureDirs } from "./render";
import { scanMissingPhotos } from "./repair";
import path from "node:path";

const PATH_PREFETCH_BATCH = 10_000;
const CANCEL_CHECK_EVERY = 100;

export interface ScanOptions {
  fullScan?: boolean;
  /** Force the missing-file check even when Django would skip it. */
  scanMissing?: boolean;
  /** Only <scan_directory>/uploads/web (/api/scanuploadedphotos). */
  uploadedOnly?: boolean;
  /** Explicit files instead of a walk (scan_files). */
  files?: string[];
  /** Leave out the follow-up jobs (benchmarks and parity runs). */
  skipFollowups?: boolean;
}

export type Group = { key: string; paths: string[] };

/** _partition_scan_paths: (directory, stem) groups in walk order with their sidecars, and orphan sidecars. */
export function partition(paths: string[]): [Group[], string[]] {
  const index = new Map<string, number>();
  const groups: Group[] = [];
  const sidecars: string[] = [];
  for (const p of paths) {
    if (fsu.isMetadata(p)) {
      sidecars.push(p);
      continue;
    }
    const key = fsu.keyStr(fsu.groupingKey(p));
    const i = index.get(key);
    if (i === undefined) {
      index.set(key, groups.length);
      groups.push({ key, paths: [p] });
    } else groups[i].paths.push(p);
  }
  const orphans: string[] = [];
  for (const p of sidecars) {
    const i = fsu.sidecarGroupingKeys(p).map((k) => index.get(fsu.keyStr(k))).find((x) => x !== undefined);
    if (i === undefined) orphans.push(p);
    else groups[i].paths.push(p);
  }
  return [groups, orphans];
}

const modifiedAfter = (p: string, t: number) => {
  const m = fsu.mtimeMs(p);
  return m !== null && m > t;
};
const changedSince = (p: string, t: number) => modifiedAfter(p, t) || sidecarFilesInPriorityOrder(p).some((s) => modifiedAfter(s, t));

/** Running error record in Django's result shape. */
class Errors {
  count = 0;
  errors: string[] = [];
  first: string | null = null;
  add(e: string) {
    this.count++;
    if (!this.errors.includes(e)) {
      this.errors.push(e);
      if (this.errors.length > 100) this.errors.splice(0, this.errors.length - 100);
    }
    this.first ??= e;
  }
  failed(target: number) {
    return target === 0 ? this.count > 0 : this.count > Math.max(10, 0.05 * target);
  }
  result(target: number) {
    if (!this.count) return {};
    return { error_count: this.count, errors: this.errors, error: this.first, status: this.failed(target) ? "failed" : "partial_failure" };
  }
}

/** LP_SCAN_VIDEOS_FIRST (default on): a video's thumbnails take ffmpeg far longer than a photo's. */
const videosFirst = () => !["0", "off", "false"].includes((process.env.LP_SCAN_VIDEOS_FIRST ?? "").trim());

/** File groups processed side by side (LP_SCAN_CONCURRENCY, else max(WORKER_CONCURRENCY, min(cores, 8))). */
export function scanConcurrency(): number {
  const n = Number(process.env.LP_SCAN_CONCURRENCY);
  if (Number.isInteger(n) && n > 0) return n;
  return Math.max(1, config.workerConcurrency, Math.min(navigator.hardwareConcurrency || 4, 8));
}

/** scan_photos. `jobId` is the LongRunningJob the UI polls. */
export async function scanUser(userId: number, jobId: string, opts: ScanOptions = {}) {
  const owner = await loadOwner(userId);
  if (!owner) throw new Error(`user ${userId} not found`);
  ensureDirs();
  await db.lrjGetOrCreate(jobId, JobType.ScanPhotos, userId);
  try {
    await scanInner(owner, jobId, opts);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`scan failed: ${msg}`);
    await lrjFail(jobId, msg);
  }
}

async function scanInner(owner: Owner, jobId: string, opts: ScanOptions) {
  const scanDirectory = opts.uploadedOnly ? fsu.joinPy(fsu.joinPy(owner.scanDirectory, "uploads"), "web") : owner.scanDirectory;
  const patterns = fsu.skipPatterns((await siteSettings()).SKIP_PATTERNS);
  let photoList: string[];
  if (!opts.files?.length) {
    // Django's walk starts with an os.stat of the directory and fails the job.
    try {
      statSync(scanDirectory);
    } catch (e) {
      throw new Error(`${(e as Error).message}: '${scanDirectory}'`);
    }
    photoList = fsu.walkDirectory(scanDirectory, patterns);
  } else {
    photoList = opts.files.filter((f) => {
      try {
        return statSync(f).isFile();
      } catch {
        return false;
      }
    });
  }
  const lastScan = await db.lastScanFinishedAt(owner.id);
  const [groups, orphans] = partition(photoList);
  let toProcess: Group[];
  if (!opts.fullScan && lastScan !== null) {
    toProcess = [];
    for (let i = 0; i < groups.length; i += PATH_PREFETCH_BATCH) {
      const batch = groups.slice(i, i + PATH_PREFETCH_BATCH);
      const known = await db.knownPaths(batch.flatMap((g) => g.paths));
      for (const g of batch) if (g.paths.some((p) => !known.has(p) || changedSince(p, lastScan))) toProcess.push(g);
    }
  } else toProcess = groups;
  // Longest jobs first: the walk puts Videos/ last, and a scan would end
  // with a tail of a few videos and idle cores.
  if (videosFirst()) {
    const hasVideo = new Map(toProcess.map((g) => [g, g.paths.some(fsu.isVideo)]));
    toProcess = [...toProcess.filter((g) => hasVideo.get(g)), ...toProcess.filter((g) => !hasVideo.get(g))];
  }

  const target = toProcess.length + orphans.length;
  const scanMissing = !!opts.scanMissing || !!opts.fullScan || (!opts.uploadedOnly && !opts.files?.length);
  const photoCountBefore = await db.photoCount(owner.id);
  await db.lrjRecordErrors(jobId, { followups: { full_scan: !!opts.fullScan, scan_missing_photos: scanMissing, photo_count_before: photoCountBefore } }, false);
  await db.lrjProgress(jobId, 0, target);
  console.info(`grouped ${photoList.length} files, ${toProcess.length} groups need processing`);

  const errors = new Errors();
  let done = 0;
  let lastFlush = Date.now();
  let cancelled = false;
  const tick = async (err: string | null) => {
    done++;
    if (err !== null) errors.add(err);
    if (err !== null || Date.now() - lastFlush >= 250) {
      lastFlush = Date.now();
      await db.lrjProgress(jobId, done, target).catch(() => {});
      if (err !== null) await db.lrjRecordErrors(jobId, errors.result(target), errors.failed(target)).catch(() => {});
    }
  };

  const t0 = performance.now();
  let next = 0;
  const worker = async () => {
    while (!cancelled && next < toProcess.length) {
      const i = next++;
      if (i % CANCEL_CHECK_EVERY === 0 && (await lrjIsCancelled(jobId).catch(() => false))) {
        cancelled = true;
        return;
      }
      const out = await handleFileGroup(owner, toProcess[i].paths);
      await tick(out.ok ? null : out.error);
    }
  };
  await Promise.all(Array.from({ length: Math.min(scanConcurrency(), Math.max(1, toProcess.length)) }, worker));
  console.info(`file groups done in ${((performance.now() - t0) / 1000).toFixed(2)} s`);

  for (const p of orphans) {
    if (cancelled) break;
    const needs = !(await db.pathIsKnown(p)) || !!opts.fullScan || lastScan === null || changedSince(p, lastScan);
    const err = needs ? await attachSidecar(owner, p) : null;
    await tick(err);
  }
  if (cancelled) {
    console.info(`scan ${jobId} cancelled`);
    return;
  }
  await db.lrjRecordErrors(jobId, errors.result(target), errors.failed(target));
  await db.lrjProgress(jobId, done, target);
  const won = await db.lrjFinish(jobId);
  console.info(`scanned ${photoList.length} files in ${scanDirectory}`);
  // The metadata batches are done: stop the ExifTool processes now rather than after the idle timeout.
  await exif.shutdown();
  await backfillMissingAspectRatios(owner.id);
  if (won && !opts.skipFollowups) {
    console.info(`Added ${(await db.photoCount(owner.id)) - photoCountBefore} photos`);
    await queueFollowups(owner.id, !!opts.fullScan, scanMissing);
  }
}

const likeEscape = (s: string) => s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");

/** handle_new_image for an XMP sidecar: attach it to the photo it describes; the error text or null. */
export async function attachSidecar(owner: Owner, p: string): Promise<string | null> {
  try {
    const hash = await fsu.calculateHash(p, owner.id);
    await begin(async (tx) => {
      if (await db.isEmbeddedMedia(tx, hash)) return;
      let found: string | null = null;
      for (const [dir, stem] of fsu.sidecarGroupingKeys(p)) {
        const prefix = `${fsu.mediaName(dir, stem)}.`;
        const rows: { id: string; path: string }[] = await tx`SELECT p.id::text AS id, f.path FROM api_photo p
          JOIN api_photo_files pf ON pf.photo_id = p.id JOIN api_file f ON f.hash = pf.file_id WHERE p.owner_id = ${owner.id}
          AND upper(f.path) LIKE upper(${`${likeEscape(prefix)}%`}) ESCAPE '\\' ORDER BY f.path`;
        const hit = rows.find((r) => {
          const k = fsu.groupingKey(r.path);
          return k[0] === dir && k[1] === stem && !fsu.isMetadata(r.path);
        });
        if (hit) {
          found = hit.id;
          break;
        }
      }
      if (!found) {
        console.warn(`no photo to metadata file found: ${p}`);
        return;
      }
      const f = await db.fileCreate(tx, p, hash, fsu.METADATA_FILE, () => fsu.exists(p));
      await db.addPhotoFile(tx, found, f.hash);
      await db.touchPhoto(tx, found);
    });
    return null;
  } catch (e) {
    return `${p}: ${(e as Error).message}`;
  }
}

/** backfill_missing_aspect_ratios. */
async function backfillMissingAspectRatios(userId: number) {
  const rows: { photo_id: string; thumbnail_big: string }[] = await client`SELECT t.photo_id::text AS photo_id, t.thumbnail_big
    FROM api_thumbnail t JOIN api_photo p ON p.id = t.photo_id WHERE p.owner_id = ${userId} AND t.aspect_ratio IS NULL AND t.thumbnail_big IS NOT NULL`;
  for (const r of rows) {
    if (!r.thumbnail_big) continue;
    const a = await aspectOf(null, path.join(config.mediaRoot, r.thumbnail_big));
    if (a !== null) await client`UPDATE api_thumbnail SET aspect_ratio = ${a} WHERE photo_id = ${r.photo_id}::uuid`;
  }
}

/** _queue_followup_jobs. */
export async function queueFollowups(userId: number, fullScan: boolean, scanMissing: boolean) {
  if (scanMissing) {
    try {
      await scanMissingPhotos(userId, crypto.randomUUID());
    } catch (e) {
      console.error(`scan missing photos failed: ${(e as Error).message}`);
    }
  }
  await enqueue("repair.file_variants", { user_id: userId }, { lrj: { jobType: JobType.RepairFileVariants, userId } });
  const f = config.features;
  if (f.sceneClassification) {
    await enqueue("tags.generate", { user_id: userId, full_scan: fullScan }, { lrj: { jobType: JobType.GenerateTags, userId } });
  }
  if (f.reverseGeocoding) {
    await enqueue("geo.locate", { user_id: userId, full_scan: fullScan }, { lrj: { jobType: JobType.AddGeolocation, userId } });
  }
  // The ML runs in the Python sidecars, so CLIP never shares the tagger's pass (Rust's in-process only).
  const clip = await enqueue("clip.embed", { user_id: userId }, { lrj: { jobType: JobType.CalculateClipEmbeddings, userId } });
  if (f.faceDetection) {
    // Django's Chain: faces run once the CLIP job has finished.
    await enqueue("faces.scan", { user_id: userId, full_scan: fullScan, skip_inline: false }, {
      lrj: { jobType: JobType.ScanFaces, userId },
      dependsOn: [clip.id],
    });
  }
}
