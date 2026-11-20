/**
 * The library's indexer (CONTRACT.md "Library"): folders the user added, kept in the shared local
 * database by `packages/local-db`'s writers from what Rust's file seams report (src/db/seams.ts).
 *
 * - Adding a root walks it (`fs_walk` batches -> `upsertWalkedFiles`) and watches it.
 * - At start every root is walked again and diffed against its rows by size and modified time
 *   (`knownFolderFiles`): only new and changed files are written, vanished ones removed. A root
 *   that cannot be read (an unplugged drive) keeps its rows.
 * - `fs://changed` batches: created/modified -> `upsertWalkedFiles`, removed -> `removeLocalPaths`
 *   (a path and everything below it), renamed -> `renameLocalPaths` (the row, its hash and upload
 *   state survive).
 * - The metadata pass reads the headers of `pendingMetadata` files (`fs_read_metadata`, 4 Rust
 *   threads) in batches of 256 -> `applyFileMetadata`.
 * - The hash pass (only while signed in: a server hash is MD5 + user id) MD5s `pendingHashes`
 *   files 4 at a time (`fs_md5`) -> `setFileHashes`, then queues what the backup needs
 *   (`enqueueBackups`).
 *
 * Writes go out as `db://changed`, which the views' live queries follow (src/db/live.ts).
 */
import {
  addFolderRoot,
  applyFileMetadata,
  enqueueBackups,
  folderRoots,
  getMeta,
  knownFolderFiles,
  libraryProgress,
  markHashUnreadable,
  mergeFolderRoot,
  pendingHashes,
  pendingMetadata,
  removeFolderRoot,
  removeLocalPaths,
  renameLocalPaths,
  setFileHashes,
  setFolderBackup,
  setMeta,
  switchFolderAccount,
  upsertWalkedFiles,
  type FileMetadata,
  type FolderRoot,
  type WalkedFile,
} from "@librephotos/local-db";
import { db } from "../db/database";
import { md5File, onFsChanged, readMetadata, unwatchRoot, walkRoot, watchRoot, type FsChanges, type FsEntry } from "../db/seams";
import { inTauri } from "../ipc";

const META_BATCH = 256;
const HASH_BATCH = 32;
const HASH_CONCURRENCY = 4;
/** app_meta key: the server account (`url|userId`) the files' hashes and upload queue belong to. */
const ACCOUNT_KEY = "folder_account";

export type LibraryProgress = { walking: boolean; files: number; pending: number };

const isWindows = navigator.userAgent.includes("Windows");
const SEP = isWindows ? "\\" : "/";

/** `C:\Pics\` -> `C:\Pics`; on Windows also `/` -> `\` (Rust's `normalize_dir`). */
export function normalizeDir(path: string): string {
  const p = isWindows ? path.replaceAll("/", "\\") : path;
  const trimmed = p.replace(/[\\/]+$/, "");
  return trimmed === "" || trimmed.endsWith(":") ? p : trimmed;
}

const samePath = (a: string, b: string) => (isWindows ? a.toLowerCase() === b.toLowerCase() : a === b);

/** Whether `path` is `dir` or inside it. */
export function isWithin(path: string, dir: string): boolean {
  if (samePath(path, dir)) return true;
  const d = dir.endsWith(SEP) ? dir.slice(0, -1) : dir;
  return path.length > d.length && path[d.length] === SEP && samePath(path.slice(0, d.length), d);
}

const titleOf = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

const walked = (f: FsEntry): WalkedFile => f;

// ------------------------------------------------------------------ progress

const walking = new Set<string>();
const progressListeners = new Set<(p: LibraryProgress) => void>();
let progressTimer = 0;

/** Indexing progress, at most every ~250 ms. */
export function onLibraryProgress(listener: (p: LibraryProgress) => void): () => void {
  progressListeners.add(listener);
  reportProgress();
  return () => progressListeners.delete(listener);
}

function reportProgress(): void {
  if (progressTimer || progressListeners.size === 0) return;
  progressTimer = window.setTimeout(() => {
    progressTimer = 0;
    void libraryProgress(db).then(
      p => {
        const out = { walking: walking.size > 0, files: p.files, pending: p.pendingMetadata };
        for (const l of progressListeners) l(out);
      },
      () => undefined,
    );
  }, 250);
}

// ------------------------------------------------------------------ passes

/** A loop that runs `pass` until it reports no work, then sleeps until woken. */
function worker(pass: () => Promise<boolean>): () => void {
  let running = false;
  let again = false;
  const wake = () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    void (async () => {
      do {
        again = false;
        try {
          while (await pass()) reportProgress();
        } catch (e) {
          console.warn("[library]", e);
        }
      } while (again);
      running = false;
      reportProgress();
    })();
  };
  return wake;
}

async function metadataPass(): Promise<boolean> {
  const batch = await pendingMetadata(db, META_BATCH);
  if (batch.length === 0) return false;
  const paths = batch.flatMap(r => (r.uri ? [r.uri] : []));
  const metas = await readMetadata(paths);
  const read: FileMetadata[] = [];
  const failed: string[] = [];
  metas.forEach((m, i) => {
    if (m) read.push(m);
    else if (paths[i] !== undefined) failed.push(paths[i]);
  });
  await applyFileMetadata(db, read, failed);
  return true;
}

let hashUser: number | null = null;
let afterHashes: () => void = () => undefined;

async function hashPass(): Promise<boolean> {
  const userId = hashUser;
  if (userId === null) return false;
  const batch = await pendingHashes(db, HASH_BATCH);
  if (batch.length === 0) {
    if ((await enqueueBackups(db)) > 0) afterHashes();
    return false;
  }
  const hashes: { path: string; md5: string }[] = [];
  const unreadable: string[] = [];
  let next = 0;
  const lane = async () => {
    while (next < batch.length) {
      const path = batch[next++]?.uri;
      if (!path) continue;
      try {
        hashes.push({ path, md5: await md5File(path) });
      } catch {
        unreadable.push(path);
      }
    }
  };
  await Promise.all(Array.from({ length: HASH_CONCURRENCY }, lane));
  await setFileHashes(db, hashes, userId);
  if (unreadable.length > 0) await markHashUnreadable(db, unreadable);
  if ((await enqueueBackups(db)) > 0) afterHashes();
  return userId === hashUser;
}

const wakeMetadata = worker(metadataPass);
const wakeHashes = worker(hashPass);

/**
 * Hash for this account (`null`: signed out, hashing waits). Signing in to another server or
 * account rebuilds the hashes for it and starts the upload queue over.
 */
export async function setLibraryAccount(account: { url: string; userId: number } | null): Promise<void> {
  if (account) {
    const key = `${account.url}|${account.userId}`;
    const before = await getMeta(db, ACCOUNT_KEY);
    if (before !== key) {
      if (before !== null) await switchFolderAccount(db, account.userId);
      await setMeta(db, ACCOUNT_KEY, key);
    }
  }
  hashUser = account?.userId ?? null;
  if (hashUser !== null) wakeHashes();
}

/** Called when the hash pass queued files for backup (wakes the backup engine). */
export function onBackupWork(listener: () => void): void {
  afterHashes = listener;
}

// ------------------------------------------------------------------ roots

let rootsCache: FolderRoot[] = [];

async function roots(): Promise<FolderRoot[]> {
  rootsCache = await folderRoots(db);
  return rootsCache;
}

/** Walks a root and brings its rows up to date: new and changed files written, vanished removed. */
async function scan(root: FolderRoot): Promise<void> {
  walking.add(root.id);
  reportProgress();
  const t0 = performance.now();
  try {
    const known = new Map((await knownFolderFiles(db, root.id)).map(f => [f.uri, f]));
    const seen = new Set<string>();
    let written = 0;
    const total = await walkRoot(root.path, async files => {
      const fresh = files.filter(f => {
        seen.add(f.path);
        const k = known.get(f.path);
        return !k || k.size_bytes !== f.size || k.modified_at !== f.mtimeMs;
      });
      if (fresh.length > 0) {
        await upsertWalkedFiles(db, root, fresh.map(walked));
        written += fresh.length;
        wakeMetadata();
        reportProgress();
      }
    });
    const gone = [...known.keys()].filter(uri => !seen.has(uri));
    if (gone.length > 0) await removeLocalPaths(db, gone);
    if (localStorage.getItem("lpLibraryTrace")) {
      console.info(`[library] walked ${root.path}: ${total} files, ${written} new/changed, ${gone.length} gone in ${Math.round(performance.now() - t0)} ms`);
    }
  } catch (e) {
    // A root that is not there (unplugged drive) keeps its rows.
    console.warn(`[library] can't read ${root.path}:`, e);
  } finally {
    walking.delete(root.id);
    wakeMetadata();
    wakeHashes();
    reportProgress();
  }
}

async function applyChanges(c: FsChanges): Promise<void> {
  const root = rootsCache.find(r => samePath(r.path, c.root)) ?? (await roots()).find(r => samePath(r.path, c.root));
  if (!root) return;
  if (c.removed.length > 0) await removeLocalPaths(db, c.removed);
  if (c.renamed.length > 0) await renameLocalPaths(db, root, c.renamed);
  const files = [...c.created, ...c.modified];
  if (files.length > 0) await upsertWalkedFiles(db, root, files.map(walked));
  wakeMetadata();
  wakeHashes();
  reportProgress();
}

let backupDefault = false;

/** Whether new roots are backed up; flips every root (`local_album.backup_selection`). */
export async function setRootsBackup(on: boolean): Promise<void> {
  backupDefault = on;
  for (const r of await roots()) if ((r.backup_selection === 1) !== on) await setFolderBackup(db, r.id, on);
  if (on) wakeHashes();
}

/**
 * Adds a folder. A folder inside a root is already in the library (that root is returned); roots
 * inside the new folder are merged into it. Walks it in the background and watches it.
 */
export async function addRoot(path: string): Promise<FolderRoot> {
  const wanted = normalizeDir(path);
  const existing = await roots();
  const holder = existing.find(r => isWithin(wanted, r.path));
  if (holder) return holder;
  const watched = await watchRoot(wanted); // validates the folder
  const id = await addFolderRoot(db, { id: crypto.randomUUID(), path: watched, title: titleOf(watched), backup: backupDefault });
  for (const inner of existing.filter(r => isWithin(r.path, watched))) {
    await unwatchRoot(inner.path).catch(() => false);
    await mergeFolderRoot(db, inner.id, id);
  }
  const root = (await roots()).find(r => r.id === id);
  if (!root) throw new Error("the folder vanished");
  void scan(root);
  return root;
}

export async function removeRoot(id: string): Promise<void> {
  const root = (await roots()).find(r => r.id === id);
  if (root) await unwatchRoot(root.path).catch(() => false);
  await removeFolderRoot(db, id);
  await roots();
  reportProgress();
}

/** The root holding `path`, if any. */
export async function rootOf(path: string): Promise<FolderRoot | null> {
  return (await roots()).find(r => isWithin(path, r.path)) ?? null;
}

let started = false;

/** Watches and rescans every root, and starts the metadata pass (once, at app start). */
export function startLibrary(): void {
  if (started || !inTauri) return;
  started = true;
  onFsChanged(c => {
    applyChanges(c).catch((e: unknown) => console.warn("[library] change batch:", e));
  });
  void (async () => {
    const all = await roots();
    for (const r of all) await watchRoot(r.path).catch((e: unknown) => console.warn(`[library] can't watch ${r.path}:`, e));
    wakeMetadata();
    for (const r of all) await scan(r);
  })();
}
