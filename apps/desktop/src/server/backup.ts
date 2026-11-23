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
  rate: number;
  uploadedFiles: number;
  uploadedBytes: number;
  error: string | null;
};

export const CHUNK_BYTES = 8 * 1024 * 1024;
const CHECK_BATCH = 32;
const CHECK_CONCURRENCY = 4;
const UPLOAD_CONCURRENCY = 2;
const IDLE_MS = 5_000;
const OFFLINE_MS = 15_000;
const RATE_WINDOW_MS = 8_000;

export function localIso(ms: number): string {
  const d = new Date(ms);
  const off = -d.getTimezoneOffset();
  const pad = (n: number, w = 2) => String(Math.trunc(Math.abs(n))).padStart(w, "0");
  const local = new Date(ms + off * 60_000).toISOString().slice(0, 23);
  return `${local}${off >= 0 ? "+" : "-"}${pad(off / 60)}:${pad(off % 60)}`;
}

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

export function wakeBackup(): void {
  const all = wakers;
  wakers = [];
  for (const wake of all) wake();
}

async function readPaused(): Promise<void> {
  const state = await invoke<{ paused: boolean }>("server_status").catch(() => null);
  if (state) paused = state.paused;
}

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

const md5Of = (hash: string) => hash.slice(0, 32);

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

function offsetOf(body: unknown): number | null {
  if (typeof body !== "object" || body === null || !("offset" in body)) return null;
  return typeof body.offset === "number" ? body.offset : null;
}

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

async function upload(job: ClaimedUpload): Promise<Outcome> {
  const path = job.uri;
  if (!path) throw new Error("the queued file has no path");
  const user = userId();
  const prep = await prepare(job, path, user);
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
        restarts++;
        offset = serverOffset;
        continue;
      }
      if (error instanceof ApiError && (error.status === 404 || error.status === 410) && uploadId && restarts < 3) {
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

let started = false;

export function startBackup(): void {
  if (started || !inTauri) return;
  started = true;
  void (async () => {
    await loadSession().catch(() => undefined);
    await readPaused();
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
