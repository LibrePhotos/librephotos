/**
 * The desktop folder library on the shared tables: roots, the file-seam
 * writers (walk, remove, rename, metadata, hashes), local search, timeline and
 * the backup queue claims.
 */
import { sql } from "drizzle-orm";
import {
  addFolderRoot,
  applyFileMetadata,
  folderRoots,
  folderWords,
  localAssetByUri,
  localTimelineDays,
  localTimelinePage,
  pendingHashes,
  pendingMetadata,
  removeFolderRoot,
  removeLocalPaths,
  renameLocalPaths,
  setFileHashes,
  upsertWalkedFiles,
  type FileMetadata,
  type WalkedFile,
} from "../queries/library";
import { ftsQuery, localSearchTerms, rebuildLocalSearch, searchLocalAssets } from "../queries/local-search";
import {
  claimExistenceChecks,
  claimNextUpload,
  enqueueBackups,
  localBackupCounts,
  markDone,
  markSkipped,
  requestUpload,
  resetInFlightUploads,
  setQueueState,
  setUploadProgress,
} from "../queries/upload-queue";
import { createTestDb, type TestDb } from "../testing";
import { remotePhoto, seedRemotePhotos } from "../fixtures";

const ROOT = "C:\\Users\\me\\Pictures";
const HOLIDAY = `${ROOT}\\Holiday 2019`;
const root = { id: "root-1", path: ROOT };
const MTIME = Date.UTC(2023, 2, 15, 10);
const USER = 7;

function file(name: string, over: Partial<WalkedFile> = {}): WalkedFile {
  return { path: `${HOLIDAY}\\${name}`, folder: HOLIDAY, name, size: 1000, mtimeMs: MTIME, kind: "image", ...over };
}

function meta(path: string, over: Partial<FileMetadata> = {}): FileMetadata {
  return {
    path,
    format: "JPEG",
    width: 4000,
    height: 3000,
    takenAt: "2019-08-01T12:00:00",
    takenMs: Date.UTC(2019, 7, 1, 12),
    camera: "Canon EOS R5",
    lens: "RF 24-105mm",
    lat: null,
    lon: null,
    ...over,
  };
}

async function uris(t: TestDb): Promise<string[]> {
  return (await t.db.all<{ uri: string }>(sql`SELECT uri FROM local_asset ORDER BY uri`)).map((r) => r.uri);
}

describe("folder library", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = createTestDb();
    await addFolderRoot(t.db, { id: "root-1", path: ROOT, title: "Pictures", backup: true }, 5);
  });
  afterEach(() => t.close());

  it("names folders from the added folder down, whatever the separator", () => {
    expect(folderWords(ROOT, HOLIDAY)).toBe("Pictures/Holiday 2019");
    expect(folderWords("/home/me/Pictures/", "/home/me/Pictures/a/b")).toBe("Pictures/a/b");
    expect(folderWords(ROOT, ROOT)).toBe("Pictures");
  });

  it("adds a root once and counts its files", async () => {
    expect(await addFolderRoot(t.db, { id: "other-id", path: ROOT, title: "Pictures" })).toBe("root-1");
    await upsertWalkedFiles(t.db, root, [file("a.jpg"), file("b.cr3", { kind: "raw" })]);
    expect(await folderRoots(t.db)).toEqual([
      { id: "root-1", path: ROOT, title: "Pictures", backup_selection: 1, added_at: 5, file_count: 2 },
    ]);
  });

  it("keeps hash and metadata of an unchanged file and drops them when it changed", async () => {
    await upsertWalkedFiles(t.db, root, [file("a.jpg")]);
    const path = file("a.jpg").path;
    await setFileHashes(t.db, [{ path, md5: "m1" }], USER);
    await applyFileMetadata(t.db, [meta(path)]);
    expect(await pendingMetadata(t.db, 10)).toEqual([]);

    await upsertWalkedFiles(t.db, root, [file("a.jpg")]); // a rescan
    let row = await localAssetByUri(t.db, path);
    expect(row).toMatchObject({ hash: `m1${USER}`, meta_state: "done", bucket_day: "2019-08-01", dated: 1 });

    await upsertWalkedFiles(t.db, root, [file("a.jpg", { size: 2000 })]); // edited
    row = await localAssetByUri(t.db, path);
    expect(row).toMatchObject({ hash: null, meta_state: "pending", dated: 0 });
    expect(await pendingHashes(t.db, 10)).toEqual([{ id: path, uri: path }]);
  });

  it("indexes name, extension, kind, folders, date words, camera and lens for search", async () => {
    await upsertWalkedFiles(t.db, root, [
      file("IMG_1234.CR3", { kind: "raw" }),
      file("beach.mp4", { kind: "video", mtimeMs: Date.UTC(2023, 2, 15, 12) }),
    ]);
    const raw = file("IMG_1234.CR3").path;
    await applyFileMetadata(t.db, [meta(raw, { format: "CR3", lens: null })]);
    expect(await localSearchTerms(t.db, raw)).toContain("2019 august aug 2019-08 2019-08-01");

    const names = async (q: string) => (await searchLocalAssets(t.db, q)).map((r) => r.name);
    expect(await names("canon raw")).toEqual(["IMG_1234.CR3"]);
    expect(await names("august 2019")).toEqual(["IMG_1234.CR3"]);
    expect(await names("cr3")).toEqual(["IMG_1234.CR3"]);
    expect(await names("holi 2019")).toEqual(["beach.mp4", "IMG_1234.CR3"]);
    expect(await names("movie")).toEqual(["beach.mp4"]);
    expect(await names("2023-03")).toEqual(["beach.mp4"]);
    expect(await names("pictures")).toEqual(["beach.mp4", "IMG_1234.CR3"]);
    expect(await names("users")).toEqual([]); // above the added folder
    expect(await names("nikon")).toEqual([]);
    expect(await names("   ")).toEqual([]);

    // Removing a file takes it out of the index; a rebuild gives the same answers.
    await removeLocalPaths(t.db, [file("beach.mp4").path]);
    expect(await names("holiday")).toEqual(["IMG_1234.CR3"]);
    await rebuildLocalSearch(t.db);
    expect(await names("holiday")).toEqual(["IMG_1234.CR3"]);
  });

  it("marks unreadable files as failed instead of asking again", async () => {
    await upsertWalkedFiles(t.db, root, [file("broken.jpg")]);
    await applyFileMetadata(t.db, [], [file("broken.jpg").path]);
    expect(await pendingMetadata(t.db, 10)).toEqual([]);
    expect((await localAssetByUri(t.db, file("broken.jpg").path))?.meta_state).toBe("failed");
  });

  it("removes a folder and everything below it, but not a sibling with the same prefix", async () => {
    await upsertWalkedFiles(t.db, root, [
      file("a.jpg"),
      { ...file("x.jpg"), path: `${HOLIDAY}\\Day 1\\x.jpg`, folder: `${HOLIDAY}\\Day 1` },
      { ...file("y.jpg"), path: `${HOLIDAY} extra\\y.jpg`, folder: `${HOLIDAY} extra` },
    ]);
    await removeLocalPaths(t.db, [HOLIDAY]);
    expect(await uris(t)).toEqual([`${HOLIDAY} extra\\y.jpg`]);
  });

  it("renames a file and a folder, keeping hash and upload state", async () => {
    await upsertWalkedFiles(t.db, root, [
      file("a.jpg"),
      { ...file("x.jpg"), path: `${HOLIDAY}\\Day 1\\x.jpg`, folder: `${HOLIDAY}\\Day 1` },
    ]);
    await setFileHashes(t.db, [{ path: file("a.jpg").path, md5: "ma" }], USER);
    await requestUpload(t.db, file("a.jpg").path);

    await renameLocalPaths(t.db, root, [{ from: file("a.jpg").path, to: `${HOLIDAY}\\renamed.jpg`, dir: false }]);
    const renamed = await localAssetByUri(t.db, `${HOLIDAY}\\renamed.jpg`);
    expect(renamed).toMatchObject({ name: "renamed.jpg", hash: `ma${USER}`, upload_state: "pending" });

    const summer = `${ROOT}\\Summer 2019`;
    await renameLocalPaths(t.db, root, [{ from: HOLIDAY, to: summer, dir: true }]);
    expect(await uris(t)).toEqual([`${summer}\\Day 1\\x.jpg`, `${summer}\\renamed.jpg`]);
    expect(await t.db.all(sql`SELECT folder FROM local_asset ORDER BY uri`)).toEqual([
      { folder: "Pictures/Summer 2019/Day 1" },
      { folder: "Pictures/Summer 2019" },
    ]);
    expect((await searchLocalAssets(t.db, "summer day")).map((r) => r.name)).toEqual(["x.jpg"]);
    // A walk after the rename finds the file at its new path: the same row, not a second one.
    await upsertWalkedFiles(t.db, root, [{ ...file("renamed.jpg"), path: `${summer}\\renamed.jpg`, folder: summer }]);
    expect(await uris(t)).toHaveLength(2);
  });

  it("builds FTS queries like the desktop did", () => {
    expect(ftsQuery("  ")).toBeNull();
    expect(ftsQuery("March 2023")).toBe('"march"* "2023"*');
    expect(ftsQuery('img_12"x')).toBe('"img"* "12"* "x"*');
    expect(ftsQuery("Zürich")).toBe('"zürich"*');
  });

  it("pages the library timeline by day and keyset", async () => {
    await upsertWalkedFiles(t.db, root, [
      file("a.jpg", { mtimeMs: Date.UTC(2023, 0, 1, 12) }),
      file("b.jpg", { mtimeMs: Date.UTC(2023, 0, 5, 12) }),
      file("c.jpg", { mtimeMs: Date.UTC(2023, 0, 5, 13) }),
    ]);
    // A camera-roll asset is not in the folder library.
    await t.db.run(sql`INSERT INTO local_asset (id, created_at) VALUES ('phone', 1)`);
    const days = await localTimelineDays(t.db);
    expect(days.map((d) => d.count)).toEqual([2, 1]);
    const first = await localTimelinePage(t.db, { limit: 2 });
    expect(first.rows.map((r) => r.name)).toEqual(["c.jpg", "b.jpg"]);
    const second = await localTimelinePage(t.db, { limit: 2, cursor: first.nextCursor });
    expect(second.rows.map((r) => r.name)).toEqual(["a.jpg"]);
    expect(second.nextCursor).toBeNull();
  });

  it("removes a root but keeps files with a live upload", async () => {
    await upsertWalkedFiles(t.db, root, [file("a.jpg"), file("b.jpg")]);
    await requestUpload(t.db, file("b.jpg").path);
    await removeFolderRoot(t.db, "root-1");
    expect(await folderRoots(t.db)).toEqual([]);
    expect(await uris(t)).toEqual([file("b.jpg").path]);
  });
});

describe("backup queue for concurrent workers", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = createTestDb();
    await addFolderRoot(t.db, { id: "root-1", path: ROOT, title: "Pictures", backup: true });
    await upsertWalkedFiles(t.db, root, [file("a.jpg"), file("b.jpg"), file("dup.jpg"), file("c.jpg")]);
    await setFileHashes(
      t.db,
      [
        { path: file("a.jpg").path, md5: "a" },
        { path: file("b.jpg").path, md5: "b" },
        { path: file("dup.jpg").path, md5: "b" }, // a second copy of b
        { path: file("c.jpg").path, md5: "c" },
      ],
      USER
    );
    await seedRemotePhotos(t.db, [remotePhoto({ id: "on-server", imageHash: `c${USER}` })]);
  });
  afterEach(() => t.close());

  it("enqueues hashed files not on the server and counts them", async () => {
    expect(await enqueueBackups(t.db, 1)).toBe(3);
    expect(await localBackupCounts(t.db, "folder")).toMatchObject({
      total: 4,
      hashed: 4,
      onServer: 1,
      pending: 3,
      pendingBytes: 3000,
    });
  });

  it("hands each upload to exactly one worker and holds a copy whose twin is uploading", async () => {
    await enqueueBackups(t.db, 1);
    const claims = await Promise.all([claimNextUpload(t.db), claimNextUpload(t.db), claimNextUpload(t.db)]);
    const ids = claims.map((c) => c?.asset_id ?? null);
    const claimed = ids.filter((x) => x != null);
    expect(new Set(claimed).size).toBe(claimed.length);
    // b and dup share a hash: only one of them may be uploading.
    expect(ids.filter((x) => x === file("b.jpg").path || x === file("dup.jpg").path)).toHaveLength(1);
    expect(ids.filter((x) => x == null)).toHaveLength(1);
  });

  it("resumes an upload from its saved offset after a restart", async () => {
    await enqueueBackups(t.db, 1);
    const claim = await claimNextUpload(t.db);
    expect(claim).not.toBeNull();
    const id = claim?.asset_id ?? "";
    await setUploadProgress(t.db, id, { uploadId: "up-1", offset: 512, fraction: 0.5 });
    expect(await resetInFlightUploads(t.db)).toBe(1);
    const again = await claimNextUpload(t.db);
    expect(again).toMatchObject({ asset_id: id, upload_id: "up-1", upload_offset: 512 });
    await markDone(t.db, id, "server-1");
    expect(await t.db.get(sql`SELECT upload_id, upload_offset FROM upload_queue WHERE asset_id = ${id}`)).toEqual({
      upload_id: null,
      upload_offset: 0,
    });
  });

  it("claims existence checks atomically", async () => {
    await enqueueBackups(t.db, 1);
    const [one, two] = await Promise.all([claimExistenceChecks(t.db, 2), claimExistenceChecks(t.db, 2)]);
    expect(one.length + two.length).toBe(3);
    for (const c of one) await markSkipped(t.db, c.asset_id);
    for (const c of two) await setQueueState(t.db, c.asset_id, "pending");
    expect((await localBackupCounts(t.db, "folder")).checking).toBe(0);
  });
});
