import { sql } from "drizzle-orm";
import { setMeta, META_FAVORITE_MIN_RATING } from "../queries/app-meta";
import {
  addFolderRoot,
  applyFileMetadata,
  localAssetByUri,
  pendingMetadata,
  requestMetadataReread,
  upsertLooseFile,
  upsertWalkedFiles,
  type FileMetadata,
  type WalkedFile,
} from "../queries/library";
import {
  clearAppOnlyFields,
  keywordsJson,
  localAssetEdits,
  normalizeKeywords,
  parseKeywords,
  refreshFavorites,
  setLocalAssetEdits,
  wallClockMs,
} from "../queries/local-edits";
import { searchLocalAssets } from "../queries/local-search";
import { createTestDb, type TestDb } from "../testing";

const ROOT = "C:\\Users\\me\\Pictures";
const root = { id: "root-1", path: ROOT };
const MTIME = Date.UTC(2023, 2, 15, 10);
const PATH = `${ROOT}\\beach.jpg`;

const walked = (over: Partial<WalkedFile> = {}): WalkedFile => ({
  path: PATH,
  folder: ROOT,
  name: "beach.jpg",
  size: 1000,
  mtimeMs: MTIME,
  kind: "image",
  ...over,
});

const meta = (over: Partial<FileMetadata> = {}): FileMetadata => ({
  path: PATH,
  format: "JPEG",
  width: 10,
  height: 10,
  takenAt: "2019-08-01T12:00:00",
  takenMs: Date.UTC(2019, 7, 1, 12),
  camera: null,
  lens: null,
  lat: null,
  lon: null,
  ...over,
});

describe("local edits", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = createTestDb();
    await addFolderRoot(t.db, { id: "root-1", path: ROOT, title: "Pictures" });
    await upsertWalkedFiles(t.db, root, [walked()]);
  });
  afterEach(() => t.close());

  it("stores rating, favourite, caption, keywords and the date taken", async () => {
    expect(
      await setLocalAssetEdits(
        t.db,
        PATH,
        { rating: 5, caption: "  Sunset at the pier ", keywords: ["Holiday", "holiday ", "Pier"], takenAt: "2020-01-02T03:04:05" },
        { appOnly: false, now: 42 }
      )
    ).toBe(true);
    expect(await localAssetEdits(t.db, PATH)).toEqual({
      id: PATH,
      rating: 5,
      isFavorite: true,
      caption: "Sunset at the pier",
      keywords: ["Holiday", "Pier"],
      takenAt: "2020-01-02T03:04:05",
      editedAt: 42,
      appOnly: [],
    });
    const row = await localAssetByUri(t.db, PATH);
    expect(row).toMatchObject({ bucket_day: "2020-01-02", created_at: Date.UTC(2020, 0, 2, 3, 4, 5), dated: 1 });
  });

  it("follows favorite_min_rating", async () => {
    await setLocalAssetEdits(t.db, PATH, { rating: 3 }, { appOnly: false });
    expect((await localAssetEdits(t.db, PATH))?.isFavorite).toBe(false);
    await setMeta(t.db, META_FAVORITE_MIN_RATING, "3");
    await refreshFavorites(t.db);
    expect((await localAssetEdits(t.db, PATH))?.isFavorite).toBe(true);
  });

  it("clears a caption and keywords with empty values and clamps ratings", async () => {
    await setLocalAssetEdits(t.db, PATH, { rating: 9, caption: "x", keywords: ["a"] }, { appOnly: false });
    await setLocalAssetEdits(t.db, PATH, { caption: "   ", keywords: [] }, { appOnly: false });
    expect(await localAssetEdits(t.db, PATH)).toMatchObject({ rating: 5, caption: null, keywords: [] });
    await setLocalAssetEdits(t.db, PATH, { rating: -2 }, { appOnly: false });
    expect((await localAssetEdits(t.db, PATH))?.rating).toBe(0);
  });

  it("answers false for a file it does not know and rejects a bad date", async () => {
    expect(await setLocalAssetEdits(t.db, "C:\\nope.jpg", { rating: 1 }, { appOnly: false })).toBe(false);
    expect(await setLocalAssetEdits(t.db, PATH, {}, { appOnly: false })).toBe(false);
    await expect(setLocalAssetEdits(t.db, PATH, { takenAt: "yesterday" }, { appOnly: false })).rejects.toThrow(
      "not a local date"
    );
  });

  it("finds a file by its caption and keywords", async () => {
    await setLocalAssetEdits(t.db, PATH, { caption: "Grandma's birthday cake", keywords: ["Family", "Bäckerei"] }, { appOnly: false });
    const names = async (q: string) => (await searchLocalAssets(t.db, q)).map((r) => r.name);
    expect(await names("birthday")).toEqual(["beach.jpg"]);
    expect(await names("grandma cake")).toEqual(["beach.jpg"]);
    expect(await names("family")).toEqual(["beach.jpg"]);
    expect(await names("backerei")).toEqual(["beach.jpg"]);
    await setLocalAssetEdits(t.db, PATH, { caption: null, keywords: [] }, { appOnly: false });
    expect(await names("birthday")).toEqual([]);
  });

  it("takes rating, caption and keywords from the metadata pass", async () => {
    await applyFileMetadata(t.db, [meta({ rating: 4, caption: "From the sidecar", keywords: ["pier"] })]);
    expect(await localAssetEdits(t.db, PATH)).toMatchObject({
      rating: 4,
      isFavorite: true,
      caption: "From the sidecar",
      keywords: ["pier"],
    });
    await applyFileMetadata(t.db, [meta()]);
    expect((await localAssetEdits(t.db, PATH))?.rating).toBe(4);
    await applyFileMetadata(t.db, [meta({ rating: null, caption: null, keywords: null })]);
    expect(await localAssetEdits(t.db, PATH)).toMatchObject({ rating: null, isFavorite: false, caption: null, keywords: [] });
  });

  it("keeps fields edited only in the app when the file is read again or changes", async () => {
    await setLocalAssetEdits(t.db, PATH, { rating: 2, caption: "mine", takenAt: "2001-02-03T04:05:06" }, { appOnly: true });
    expect((await localAssetEdits(t.db, PATH))?.appOnly).toEqual(["rating", "caption", "takenAt"]);
    await upsertWalkedFiles(t.db, root, [walked({ size: 2000 })]);
    expect(await localAssetByUri(t.db, PATH)).toMatchObject({ created_at: Date.UTC(2001, 1, 3, 4, 5, 6), dated: 1 });
    await applyFileMetadata(t.db, [meta({ rating: 5, caption: "file", keywords: ["k"] })]);
    expect(await localAssetEdits(t.db, PATH)).toMatchObject({
      rating: 2,
      caption: "mine",
      keywords: ["k"],
      takenAt: "2001-02-03T04:05:06",
    });
    await setLocalAssetEdits(t.db, PATH, { rating: 3 }, { appOnly: false });
    await clearAppOnlyFields(t.db, PATH, ["takenAt"]);
    expect((await localAssetEdits(t.db, PATH))?.appOnly).toEqual(["caption"]);
    await applyFileMetadata(t.db, [meta({ rating: 5, caption: "file" })]);
    expect(await localAssetEdits(t.db, PATH)).toMatchObject({ rating: 5, caption: "mine", takenAt: "2019-08-01T12:00:00" });
  });

  it("stores edits of a loose file", async () => {
    const loose = walked({ path: "D:\\x.jpg", folder: "D:\\", name: "x.jpg" });
    await upsertLooseFile(t.db, loose);
    await setLocalAssetEdits(t.db, loose.path, { rating: 1 }, { appOnly: true });
    expect(await localAssetEdits(t.db, loose.path)).toMatchObject({ rating: 1, appOnly: ["rating"] });
    expect(await t.db.get(sql`SELECT COUNT(*) AS n FROM local_asset WHERE rating IS NOT NULL`)).toEqual({ n: 1 });
  });

  it("asks for every read file again once", async () => {
    await applyFileMetadata(t.db, [meta()]);
    expect(await pendingMetadata(t.db, 10)).toEqual([]);
    expect(await requestMetadataReread(t.db)).toBe(1);
    expect(await pendingMetadata(t.db, 10)).toEqual([{ id: PATH, uri: PATH }]);
    expect(await requestMetadataReread(t.db)).toBe(0);
  });

  it("normalizes and parses keywords", () => {
    expect(normalizeKeywords([" a", "A", "", "b "])).toEqual(["a", "b"]);
    expect(keywordsJson([])).toBeNull();
    expect(keywordsJson(null)).toBeNull();
    expect(parseKeywords('["a",1,"b"]')).toEqual(["a", "b"]);
    expect(parseKeywords("not json")).toEqual([]);
    expect(parseKeywords('{"a":1}')).toEqual([]);
    expect(wallClockMs("2020-02-30T00:00:00")).toBe(Date.UTC(2020, 1, 30));
    expect(wallClockMs("2020-02-03")).toBeNull();
  });
});
