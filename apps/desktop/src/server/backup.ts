/**
 * The backup engine (CONTRACT.md "Backup"): asks the server which library files it has and uploads
 * the rest, with `packages/api-client` endpoints only (`uploadExists`, `uploadChunk`,
 * `completeUpload`, `sealUploadImports`). Its queue is the shared local database's `upload_queue`
 * (`packages/local-db`), so nothing is lost on a restart or a reloaded UI; Rust reads each chunk
 * straight into its request (`nativeFilePart({ path, offset, len })`, see ./transport).
 *
 * - Queue: the indexer hashes library files and `enqueueBackups` queues those of backed-up roots
 *   the server lacks; "Upload" on a single file is `requestUpload`.
 * - Checker: `claimExistenceChecks` (32 at a time), `uploadExists` 4 at a time -> `markSkipped`
 *   (on the server) or `markAbsent` (an uploader takes it; never checked again).
 * - Uploaders (2; never while paused): `claimNextUpload` (atomic; a copy whose twin is uploading
 *   waits), re-stat (a changed file is hashed again and starts over), re-check `exists` (dedupe),
 *   then 8 MB chunks, `setUploadProgress` after each (a restart resumes; a 400 naming another
 *   offset continues there, an expired upload starts over), then `completeUpload` -> `markDone`.
 *   Failures -> `markFailed` (the package's backoff and attempt cap); network errors, 5xx, 429
 *   and 401 do not count: the row just goes back to pending. When the queue runs dry the
 *   collected `job_id`s are sealed with `sealUploadImports`.
 * - `resetInFlightUploads` at start: checks in flight are asked again, uploads resume.
 */
import {
  claimExistenceChecks,
  claimNextUpload,
  markAbsent,
  markDone,
  markFailed,
  markSkipped,
  resetInFlightUploads,
  setFileHashes,
  setQueueState,
  setUploadProgress,
  type ClaimedUpload,
} from "@librephotos/local-db";
import { ApiError, endpoints, nativeFilePart } from "@librephotos/api-client/core";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { db, hub } from "../db/database";
import { md5File, statPaths } from "../db/seams";
import { inTauri } from "../ipc";
import { errorMessage, isTransient, NotSignedIn, serverCall } from "./errors";
import { client, isSignedIn, loadSession, onSessionChange, signedInUser } from "./session";

export type Upload = { name: string; sent: number; total: number };
export type BackupStats = {
  uploads: Upload[];
  /** Bytes per second over the last ~8 s. */
  rate: number;
  uploadedFiles: number;
  uploadedBytes: number;
  /** The last network or server problem, until a request works again. */
  error: string | null;
};

export const CHUNK_BYTES = 8 * 1024 * 1024;
const CHECK_BATCH = 32;
const CHECK_CONCURRENCY = 4;
const UPLOAD_CONCURRENCY = 2;
/** Idle loops look for work at least this often (a missed wake-up costs no more). */
const IDLE_MS = 5_000;
/** After a network error a loop waits this long. */
const OFFLINE_MS = 15_000;
const RATE_WINDOW_MS = 8_000;

/** `ms` as ISO 8601 local time with its UTC offset, for `device_modified_at`. */
export function localIso(ms: number): string {
  const d = new Date(ms);
  const off = -d.getTimezoneOffset();
  const pad = (n: number, w = 2) => String(Math.trunc(Math.abs(n))).padStart(w, "0");
  const local = new Date(ms + off * 60_000).toISOString().slice(0, 23);
  return `${local}${off >= 0 ? "+" : "-"}${pad(off / 60)}:${pad(off % 60)}`;
}

// ------------------------------------------------------------------ state

const current = new Map<string, Upload>();
const samples: { at: number; bytes: number }[] = [];
let uploadedFiles = 0;
let uploadedBytes = 0;
let lastError: string | null = null;
let jobIds: string[] = [];
let paused = false;
const listeners = new Set<() => void>();
let wakers: (() => void)[] = [];

function changed(): void {
  for (const listener of listeners) listener();
}

/** Calls `listener` when the upload progress or the engine's error changes. */
export function onBackupChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function backupStats(): BackupStats {
  const now = performance.now();
  while (samples.length > 0 && now - (samples[0]?.at ?? now) > RATE_WINDOW_MS) samples.shift();
  const first = samples[0];
  const secs = first ? Math.max(1, (now - first.at) / 1000) : 1;
  return {
    uploads: [...current.values()].map(u => ({ ...u })),
    rate: samples.reduce((sum, s) => sum + s.bytes, 0) / secs,
    uploadedFiles,
    uploadedBytes,
    error: lastError,
  };
}

function setError(error: string | null): void {
  if (error === lastError) return;
  lastError = error;
  changed();
}

/** Look for work now (files were queued, the backup switch flipped, someone signed in). */
export function wakeBackup(): void {
  const all = wakers;
  wakers = [];
  for (const wake of all) wake();
}

/** Uploads wait while paused (checks go on); the switch lives in Rust's settings. */
async function readPaused(): Promise<void> {
  const state = await invoke<{ paused: boolean }>("server_status").catch(() => null);
  if (state) paused = state.paused;
}

/** Waits `ms`, or less when woken. */
function idle(ms: number): Promise<void> {
  return new Promise(resolve => {
    const done = () => {
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(() => {
      wakers = wakers.filter(w => w !== done);
      resolve();
    }, ms);
    wakers.push(done);
  });
}

const sleep = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms));

/** Runs `work` over `items`, `limit` at a time. */
async function pool<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const item = items[next++];
      if (item !== undefined) await work(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

function userId(): number {
  const id = signedInUser();
  if (id === null) throw new NotSignedIn();
  return id;
}

/** The MD5 in a server image hash (MD5 hex + user id). */
const md5Of = (hash: string) => hash.slice(0, 32);

// ------------------------------------------------------------------ checker

async function check(item: { asset_id: string; hash: string }): Promise<void> {
  try {
    const answer = await serverCall(() => endpoints.uploadExists(client, md5Of(item.hash), userId()));
    if (answer.exists) await markSkipped(db, item.asset_id);
    else await markAbsent(db, item.asset_id);
  } catch (error) {
    if (isTransient(error)) await setQueueState(db, item.asset_id, "pending");
    else await markFailed(db, item.asset_id, errorMessage(error));
    throw error;
  }
}

async function checkLoop(): Promise<void> {
  for (;;) {
    if (!isSignedIn()) {
      await idle(IDLE_MS);
      continue;
    }
    const items = await claimExistenceChecks(db, CHECK_BATCH).catch(() => []);
    if (items.length === 0) {
      await idle(IDLE_MS);
      continue;
    }
    let offline: unknown = null;
    await pool(items, CHECK_CONCURRENCY, item =>
      check(item).catch((error: unknown) => {
        if (isTransient(error)) offline = error;
      }),
    );
    wakeBackup();
    if (offline !== null) {
      setError(errorMessage(offline));
      await sleep(OFFLINE_MS);
    } else {
      setError(null);
    }
  }
}

// ------------------------------------------------------------------ uploader

/** The `offset` a refused chunk's answer names (the server holds a different amount). */
function offsetOf(body: unknown): number | null {
  if (typeof body !== "object" || body === null || !("offset" in body)) return null;
  return typeof body.offset === "number" ? body.offset : null;
}

/** The file as it is now: a changed file is hashed again and its upload starts over. */
async function prepare(job: ClaimedUpload, path: string, user: number) {
  const [now] = await statPaths([path]);
  if (!now) throw new Error(`${path} is gone`);
  if (now.size === 0) throw new Error("the file is empty");
  const fresh = now.size === job.size_bytes && now.mtimeMs === job.modified_at;
  let md5 = job.hash && fresh ? md5Of(job.hash) : null;
  if (!md5) {
    md5 = await md5File(path);
    await setFileHashes(db, [{ path, md5 }], user);
  }
  const resume = fresh && job.upload_id ? { uploadId: job.upload_id, offset: Math.min(Math.max(job.upload_offset, 0), now.size) } : null;
  return { md5, size: now.size, mtime: now.mtimeMs, uploadId: resume?.uploadId ?? null, offset: resume?.offset ?? 0 };
}

type Outcome = { kind: "skipped" } | { kind: "done"; photoId: string };

/** Uploads one claimed file. */
async function upload(job: ClaimedUpload): Promise<Outcome> {
  const path = job.uri;
  if (!path) throw new Error("the queued file has no path");
  const user = userId();
  const prep = await prepare(job, path, user);
  // Deduplicate: whatever the server already has never goes up again.
  const known = await serverCall(() => endpoints.uploadExists(client, prep.md5, user));
  if (known.exists) return { kind: "skipped" };

  const name = job.name ?? path.split(/[\\/]/).pop() ?? "file";
  const progress: Upload = { name, sent: prep.offset, total: prep.size };
  current.set(job.asset_id, progress);
  changed();
  let uploadId = prep.uploadId;
  let offset = prep.offset;
  let restarts = 0;
  while (offset < prep.size) {
    const len = Math.min(CHUNK_BYTES, prep.size - offset);
    const form = new FormData();
    // Rust reads the chunk into the request itself (see ./transport): no bytes through JavaScript.
    form.append("file", nativeFilePart({ path, offset, len }, name));
    form.append("offset", String(offset));
    form.append("md5", prep.md5);
    if (uploadId) form.append("upload_id", uploadId);
    let answer;
    try {
      answer = await serverCall(() => endpoints.uploadChunk(client, { form_data: form, offset, chunk_size: len }));
    } catch (error) {
      const serverOffset = error instanceof ApiError && error.status === 400 ? offsetOf(error.body) : null;
      if (serverOffset !== null && uploadId && restarts < 3) {
        // The server holds a different amount: continue from there.
        restarts++;
        offset = serverOffset;
        continue;
      }
      if (error instanceof ApiError && (error.status === 404 || error.status === 410) && uploadId && restarts < 3) {
        // The upload expired, completed or was deleted on the server: start over.
        restarts++;
        uploadId = null;
        offset = 0;
        continue;
      }
      throw error;
    }
    if (answer.offset <= offset) throw new Error(`the server kept ${answer.offset} of ${offset + len} bytes`);
    const sent = answer.offset - offset;
    uploadId = answer.upload_id;
    offset = answer.offset;
    await setUploadProgress(db, job.asset_id, { uploadId, offset, fraction: offset / prep.size });
    samples.push({ at: performance.now(), bytes: sent });
    uploadedBytes += sent;
    progress.sent = offset;
    changed();
  }
  if (!uploadId) throw new Error("the server gave no upload id");

  const form = new FormData();
  form.append("upload_id", uploadId);
  form.append("md5", prep.md5);
  form.append("filename", name);
  form.append("device_modified_at", localIso(prep.mtime));
  const done = await serverCall(() => endpoints.completeUpload(client, form));
  if (done.job_id) jobIds.push(done.job_id);
  uploadedFiles++;
  if (!done.photo_id) throw new Error("the server made no photo from this file");
  return { kind: "done", photoId: done.photo_id };
}

/** Tells the server the run is over, so its import jobs finish now (else after a few idle minutes). */
async function seal(): Promise<void> {
  if (jobIds.length === 0) return;
  const ids = jobIds;
  jobIds = [];
  try {
    await serverCall(() => endpoints.sealUploadImports(client, ids));
  } catch {
    jobIds.push(...ids);
  }
}

async function uploadLoop(): Promise<void> {
  for (;;) {
    if (!isSignedIn() || paused) {
      await idle(IDLE_MS);
      continue;
    }
    const job = await claimNextUpload(db).catch(() => null);
    if (!job) {
      await seal();
      await idle(IDLE_MS);
      continue;
    }
    let offline = false;
    try {
      const outcome = await upload(job);
      if (outcome.kind === "done") await markDone(db, job.asset_id, outcome.photoId);
      else await markSkipped(db, job.asset_id);
      setError(null);
    } catch (error) {
      offline = isTransient(error);
      if (offline) {
        // Not the file's fault: it goes back in line, the attempt does not count.
        await setQueueState(db, job.asset_id, "pending").catch(() => undefined);
        setError(errorMessage(error));
      } else {
        console.warn(`[backup] ${job.uri ?? job.asset_id}: ${errorMessage(error)}`);
        await markFailed(db, job.asset_id, errorMessage(error)).catch(() => undefined);
      }
    } finally {
      current.delete(job.asset_id);
      changed();
    }
    if (offline) await sleep(OFFLINE_MS);
  }
}

// ------------------------------------------------------------------ start

let started = false;

/** Starts the checker and the uploaders once (the desktop app only). */
export function startBackup(): void {
  if (started || !inTauri) return;
  started = true;
  void (async () => {
    await loadSession().catch(() => undefined);
    await readPaused();
    // A reloaded UI left checks and uploads half done: they start over (uploads resume).
    await resetInFlightUploads(db).catch(() => undefined);
    onSessionChange(wakeBackup);
    hub.watch(["upload_queue"], wakeBackup);
    void listen("server://status", () => {
      void readPaused().then(wakeBackup);
    });
    void checkLoop();
    for (let i = 0; i < UPLOAD_CONCURRENCY; i++) void uploadLoop();
  })();
}
