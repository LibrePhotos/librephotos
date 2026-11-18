/**
 * The backup engine (CONTRACT.md "Backup"): asks the server which library files it has and uploads
 * the rest, with `packages/api-client` endpoints only (`uploadExists`, `uploadChunk`,
 * `completeUpload`, `sealUploadImports`). Rust keeps everything that must survive a restart (the
 * queue and each file's state in the library database, the resumable upload's id and offset after
 * every chunk), hashes files and reads each chunk straight into its request (`backup_*` commands,
 * `src-tauri/src/server/backup.rs`; `nativeFilePart` in `./transport`).
 *
 * - Checker: files in state `unknown`, newest first, 4 at a time: MD5 (Rust), then
 *   `uploadExists` -> `present` (copies with the same MD5 follow, no request) or `absent`.
 * - Uploaders (2): with backup on, every library file the server lacks; always, files queued by
 *   hand; never while paused. Re-check `exists` (dedupe), then 8 MB chunks, then complete. A failure
 *   retries after 10 s, 20 s, 40 s, ... (at most 6 attempts; network errors do not count). When the
 *   queue runs dry the import jobs of the run are sealed.
 */
import { ApiError, endpoints, nativeFilePart } from "@librephotos/api-client/core";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { inTauri } from "../ipc";
import { errorMessage, isTransient, NotSignedIn, serverCall } from "./errors";
import { client, isSignedIn, loadSession, onSessionChange, signedInUser } from "./session";

/** A library file the engine checks or uploads (`library::db::Job`). */
type Job = {
  id: number;
  path: string;
  name: string;
  size: number;
  mtime: number;
  md5: string | null;
  attempts: number;
  uploadId: string | null;
  uploadOffset: number;
};
/** The file as it is now, and where a previous run stopped (`backup_prepare`). */
type Prepared = { md5: string; size: number; mtime: number; uploadId: string | null; offset: number };

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
const MAX_ATTEMPTS = 6;
/** Idle loops look for work at least this often (a missed wake-up costs no more). */
const IDLE_MS = 5_000;
/** After a network error a loop waits this long. */
const OFFLINE_MS = 15_000;
const RATE_WINDOW_MS = 8_000;

/** Milliseconds before retry `attempt` (1-based): 10 s, 20 s, 40 s, ... up to an hour. */
export function backoffMs(attempt: number): number {
  return Math.min(10_000 * 2 ** Math.min(Math.max(attempt - 1, 0), 9), 3_600_000);
}

/** `ms` as ISO 8601 local time with its UTC offset, for `device_modified_at`. */
export function localIso(ms: number): string {
  const d = new Date(ms);
  const off = -d.getTimezoneOffset();
  const pad = (n: number, w = 2) => String(Math.trunc(Math.abs(n))).padStart(w, "0");
  const local = new Date(ms + off * 60_000).toISOString().slice(0, 23);
  return `${local}${off >= 0 ? "+" : "-"}${pad(off / 60)}:${pad(off % 60)}`;
}

// ------------------------------------------------------------------ state

const current = new Map<number, Upload>();
const samples: { at: number; bytes: number }[] = [];
let uploadedFiles = 0;
let uploadedBytes = 0;
let lastError: string | null = null;
let jobIds: string[] = [];
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

/** Look for work now (a file was added, the backup switch flipped, someone signed in). */
export function wakeBackup(): void {
  const all = wakers;
  wakers = [];
  for (const wake of all) wake();
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

const setRemote = (id: number, state: "present" | "absent" | "unknown", photoId: string | null) =>
  invoke("backup_set_remote", { id, state, photoId });

// ------------------------------------------------------------------ checker

async function check(job: Job): Promise<void> {
  try {
    const md5 = job.md5 ?? (await invoke<string>("backup_hash", { id: job.id }));
    const answer = await serverCall(() => endpoints.uploadExists(client, md5, userId()));
    await setRemote(job.id, answer.exists ? "present" : "absent", answer.exists ? (answer.photo_id ?? "") : null);
  } catch (error) {
    if (isTransient(error)) await setRemote(job.id, "unknown", null);
    // Unreadable (gone, locked) or refused: leave it until it changes.
    else await invoke("backup_set_failed", { id: job.id, error: errorMessage(error), attempts: MAX_ATTEMPTS, nextTryMs: 0 });
    throw error;
  }
}

async function checkLoop(): Promise<void> {
  for (;;) {
    if (!isSignedIn()) {
      await idle(IDLE_MS);
      continue;
    }
    const jobs = await invoke<Job[]>("backup_claim_checks", { limit: CHECK_BATCH }).catch(() => []);
    if (jobs.length === 0) {
      await idle(IDLE_MS);
      continue;
    }
    let offline: unknown = null;
    await pool(jobs, CHECK_CONCURRENCY, job =>
      check(job).catch((error: unknown) => {
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

/** Uploads one claimed file; resolves with the server's photo id. */
async function upload(job: Job): Promise<string> {
  const prep = await invoke<Prepared>("backup_prepare", { id: job.id });
  // Deduplicate: whatever the server already has never goes up again.
  const known = await serverCall(() => endpoints.uploadExists(client, prep.md5, userId()));
  if (known.exists) return known.photo_id ?? "";

  const progress: Upload = { name: job.name, sent: prep.offset, total: prep.size };
  current.set(job.id, progress);
  changed();
  let uploadId = prep.uploadId;
  let offset = prep.offset;
  let restarts = 0;
  while (offset < prep.size) {
    const len = Math.min(CHUNK_BYTES, prep.size - offset);
    const form = new FormData();
    // Rust reads the chunk into the request itself (see ./transport): no bytes through JavaScript.
    form.append("file", nativeFilePart({ id: job.id, offset, len }, job.name));
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
    await invoke("backup_set_progress", { id: job.id, uploadId, offset });
    samples.push({ at: performance.now(), bytes: sent });
    uploadedBytes += sent;
    progress.sent = offset;
    changed();
  }
  if (!uploadId) throw new Error("the server gave no upload id");

  const form = new FormData();
  form.append("upload_id", uploadId);
  form.append("md5", prep.md5);
  form.append("filename", job.name);
  form.append("device_modified_at", localIso(prep.mtime));
  let done;
  try {
    done = await serverCall(() => endpoints.completeUpload(client, form));
  } catch (error) {
    // A completion that failed for good leaves nothing to resume.
    if (!isTransient(error)) await invoke("backup_set_progress", { id: job.id, uploadId: null, offset: 0 });
    throw error;
  }
  if (done.job_id) jobIds.push(done.job_id);
  uploadedFiles++;
  if (!done.photo_id) throw new Error("the server made no photo from this file");
  return done.photo_id;
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
    if (!isSignedIn()) {
      await idle(IDLE_MS);
      continue;
    }
    const job = await invoke<Job | null>("backup_claim_upload").catch(() => null);
    if (!job) {
      await seal();
      const next = await invoke<number | null>("backup_next_retry").catch(() => null);
      await idle(next === null ? IDLE_MS : Math.min(Math.max(next - Date.now(), 200), IDLE_MS));
      continue;
    }
    let offline = false;
    try {
      const photoId = await upload(job);
      await setRemote(job.id, "present", photoId);
      setError(null);
    } catch (error) {
      offline = isTransient(error);
      const attempts = offline ? job.attempts : job.attempts + 1;
      if (!offline) console.warn(`[backup] ${job.path}: ${errorMessage(error)}`);
      await invoke("backup_set_failed", {
        id: job.id,
        error: errorMessage(error),
        attempts,
        nextTryMs: Date.now() + backoffMs(Math.max(attempts, 1)),
      }).catch(() => undefined);
      if (offline) setError(errorMessage(error));
    } finally {
      current.delete(job.id);
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
    // A reloaded UI left checks and uploads half done: they start over (uploads resume).
    await invoke("backup_reset").catch(() => undefined);
    onSessionChange(wakeBackup);
    void listen("library://changed", wakeBackup);
    void listen("server://status", wakeBackup);
    void checkLoop();
    for (let i = 0; i < UPLOAD_CONCURRENCY; i++) void uploadLoop();
  })();
}
