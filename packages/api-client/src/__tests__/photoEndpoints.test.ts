/**
 * The photo endpoints the web and mobile apps share (issue #2347): the request each one sends and
 * the parsed answer, against the backend's answers. photoDetail.json is what GET /api/photos/{hash}/
 * answered for a test photo with one named face, shared to a second user.
 */
import { describe, expect, it } from "vitest";
import * as endpoints from "../endpoints";
import type { SelectAllPhotos } from "../endpoints";
import { Photo, PhotoMetadata, PhotoOcrData, PigPhoto, RecentlyAddedPhotosResponse, SharedPhoto } from "../schemas";
import { ApiError, type ApiClient } from "../transport";
import { ResponseParseError } from "../util/parse";
import { defined } from "./defined";
import photoDetail from "./fixtures/photoDetail.json";
import photoMetadata from "./fixtures/photoMetadata.json";
import userAlbumCards from "./fixtures/userAlbumCards.json";
import { fakeServer } from "./harness";

const API = "https://demo.example.com/api";
const hashesAnswer = { status: true, count: 1, updated_hashes: ["h1"], not_updated_hashes: [] };
const selectAll = { query: { favorite: true }, excludedHashes: ["x"] };
const selectAllBody = { select_all: true, query: { favorite: true }, excluded_hashes: ["x"] };

describe("photo details", () => {
  it("reads the detail PhotoSerializer sends", async () => {
    const { client, requests } = fakeServer(photoDetail);
    const photo = await endpoints.fetchPhotoDetails(client, photoDetail.image_hash);
    expect(defined(requests[0]).url).toBe(`${API}/photos/${photoDetail.image_hash}/`);
    expect(defined(photo.people[0]).name).toBe("Ann");
    expect(photo.shared_to).toEqual([2]);
    expect(photo.square_thumbnail_url).toBe(photoDetail.square_thumbnail_url);
    expect(photo.local_orientation).toBe(1);
  });

  it("fills in the category fields a server before 1.3 does not send", () => {
    const { is_screenshot: _s, is_document: _d, category_source: _c, ...older } = photoDetail;
    const photo = Photo.parse(older);
    expect([photo.is_screenshot, photo.is_document, photo.category_source]).toEqual([false, false, "auto"]);
  });

  it("reads OCR text as optional (older server) and nullable (no OCR row)", () => {
    const ocr = {
      text: "TOTAL 12.34",
      blocks: [
        {
          text: "TOTAL 12.34",
          box: [
            [0.1, 0.1],
            [0.6, 0.1],
            [0.6, 0.2],
            [0.1, 0.2],
          ],
          confidence: 0.95,
        },
      ],
    };
    expect(Photo.parse({ ...photoDetail, ocr }).ocr?.text).toBe("TOTAL 12.34");
    expect(Photo.parse({ ...photoDetail, ocr: null }).ocr).toBeNull();
    const { ocr: _ocr, ...older } = photoDetail;
    expect(Photo.parse(older).ocr).toBeUndefined();
    expect(PhotoOcrData.parse({ text: "legacy", blocks: [] }).blocks).toEqual([]);
    const flatBox = { text: "x", blocks: [{ text: "x", box: [0, 0, 10, 10], confidence: 0.9 }] };
    expect(PhotoOcrData.safeParse(flatBox).success).toBe(false);
  });

  it("keeps a grid photo's HDR flag, false for a server that predates it", () => {
    const schema = PigPhoto.pick({ image_hash: true, is_hdr: true });
    expect(schema.parse({ image_hash: "abc", is_hdr: true }).is_hdr).toBe(true);
    expect(schema.parse({ image_hash: "abc" })).toEqual({ image_hash: "abc", is_hdr: false });
  });

  it("reads recently added photos of an empty library (date null), and still requires the date", () => {
    expect(RecentlyAddedPhotosResponse.parse({ date: null, results: [] })).toEqual({ date: null, results: [] });
    expect(RecentlyAddedPhotosResponse.safeParse({ results: [] }).success).toBe(false);
  });

  it("reads the albums that hold a photo", async () => {
    const { client, requests } = fakeServer({ results: userAlbumCards });
    const albums = await endpoints.fetchPhotoAlbums(client, "h1");
    expect(defined(requests[0]).url).toBe(`${API}/photos/h1/albums/`);
    expect(albums.map(album => album.title)).toEqual(["Berlin 2024", "Still empty"]);
  });
});

/**
 * PhotoMetadataSerializer: `id` is a UUID (PhotoMetadata has a UUIDField primary key), and it sends
 * neither `photo_id` nor `has_edits` (that one is only on the summary serializer).
 */
describe("photo metadata", () => {
  /** What the viewset answers for a photo never scanned: it creates a near-empty row on the fly. */
  const freshMetadata = {
    ...photoMetadata,
    ...Object.fromEntries(
      Object.entries(photoMetadata)
        .filter(
          ([key, value]) => typeof value !== "object" && !["id", "source", "created_at", "updated_at"].includes(key)
        )
        .map(([key]) => [key, null])
    ),
    has_location: false,
    version: 1,
    keywords: null,
    edit_history: [],
    sidecar_files: [],
  };

  it("reads a photo's metadata, with its edit history and sidecar files", async () => {
    const { client, requests } = fakeServer(photoMetadata);
    const metadata = await endpoints.fetchPhotoMetadata(client, "h1");
    expect(defined(requests[0])).toEqual({ url: `${API}/photos/h1/metadata`, method: "GET", body: undefined });
    expect(metadata.camera_display).toBe("FUJIFILM X-T4");
    expect(metadata.keywords).toEqual(["architecture", "munich"]);
    expect(defined(metadata.edit_history[0]).user_name).toBe("derneuere");
    expect(defined(metadata.sidecar_files[0]).file_type).toBe("xmp");
  });

  it("reads the near-empty row of an unscanned photo (keywords null)", () => {
    expect(PhotoMetadata.parse(freshMetadata).keywords).toBeNull();
  });

  it("rejects a numeric id and drops has_edits", () => {
    expect(PhotoMetadata.safeParse({ ...photoMetadata, id: 42 }).success).toBe(false);
    expect(PhotoMetadata.parse({ ...photoMetadata, has_edits: true })).not.toHaveProperty("has_edits");
  });

  it("changes a photo's metadata and reads back the new metadata", async () => {
    const { client, requests } = fakeServer(photoMetadata);
    const metadata = await endpoints.updatePhotoMetadata(client, "h1", { rating: 4 });
    expect(defined(requests[0])).toEqual({ url: `${API}/photos/h1/metadata`, method: "PATCH", body: { rating: 4 } });
    expect(metadata.rating).toBe(4);
  });

  it("changes the metadata of several photos", async () => {
    const { client, requests } = fakeServer({ updated_count: 2, message: "Updated metadata for 2 photos" });
    const answer = await endpoints.bulkUpdatePhotoMetadata(client, ["h1", "h2"], { keywords: ["a"] });
    expect(defined(requests[0])).toEqual({
      url: `${API}/photos/metadata/bulk`,
      method: "PATCH",
      body: { photo_ids: ["h1", "h2"], updates: { keywords: ["a"] } },
    });
    expect(answer.updated_count).toBe(2);
  });
});

describe("photo edits", () => {
  it("changes fields of one photo and reads back its hash", async () => {
    const answer = {
      image_hash: "h1",
      hidden: false,
      rating: 0,
      in_trashcan: false,
      removed: false,
      video: false,
      exif_timestamp: "2024-03-15T14:23:11Z",
      timestamp: null,
      exif_gps_lat: null,
      exif_gps_lon: null,
      is_screenshot: false,
      is_document: false,
      category_source: "auto",
    };
    const { client, requests } = fakeServer(answer);
    const edited = await endpoints.updatePhoto(client, "h1", { exif_timestamp: "2024-03-15T14:23:11" });
    expect(defined(requests[0])).toEqual({
      url: `${API}/photos/edit/h1/`,
      method: "PATCH",
      body: { exif_timestamp: "2024-03-15T14:23:11" },
    });
    expect(edited.image_hash).toBe("h1");
  });

  it("rotates a photo", async () => {
    const answer = { status: true, image_hash: "h1", local_orientation: 6, last_modified: "2026-10-12T17:00:00Z" };
    const { client, requests } = fakeServer(answer);
    expect(await endpoints.rotatePhoto(client, "h1", 90)).toEqual(answer);
    expect(defined(requests[0])).toEqual({
      url: `${API}/photosedit/rotate/`,
      method: "POST",
      body: { image_hash: "h1", angle: 90 },
    });
  });

  it("asks for a generated caption", async () => {
    const { client, requests } = fakeServer({ status: true });
    await endpoints.generatePhotoCaption(client, "h1");
    expect(defined(requests[0])).toEqual({
      url: `${API}/photosedit/generateim2txt/`,
      method: "POST",
      body: { image_hash: "h1" },
    });
  });

  it("fails a caption request while the model downloads with its code", async () => {
    const downloading = { errors: [{ field: "detail", message: "Downloading.", code: "model_downloading" }] };
    await expect(endpoints.generatePhotoCaption(fakeServer(downloading, 503).client, "h1")).rejects.toMatchObject({
      status: 503,
      serverCode: "model_downloading",
    });
  });
});

describe("bulk photo mutations", () => {
  type Send = (client: ApiClient, selection?: SelectAllPhotos) => Promise<{ count?: number }>;
  const cases: { name: string; url: string; value: Record<string, unknown>; send: Send }[] = [
    {
      name: "favorite",
      url: "/photosedit/favorite/",
      value: { favorite: true },
      send: (client, selection) => endpoints.setPhotosFavorite(client, ["h1"], true, selection),
    },
    {
      name: "hide",
      url: "/photosedit/hide/",
      value: { hidden: true },
      send: (client, selection) => endpoints.setPhotosHidden(client, ["h1"], true, selection),
    },
    {
      name: "trash",
      url: "/photosedit/setdeleted/",
      value: { deleted: true },
      send: (client, selection) => endpoints.setPhotosDeleted(client, ["h1"], true, selection),
    },
    {
      name: "make public",
      url: "/photosedit/makepublic/",
      value: { val_public: false },
      send: (client, selection) => endpoints.setPhotosPublic(client, ["h1"], false, selection),
    },
    {
      name: "category",
      url: "/photosedit/category/",
      value: { category: "screenshot" },
      send: (client, selection) => endpoints.setPhotosCategory(client, ["h1"], "screenshot", selection),
    },
    {
      name: "share",
      url: "/photosedit/share/",
      value: { val_shared: true, target_user_id: 2 },
      send: (client, selection) => endpoints.setPhotosShared(client, ["h1"], 2, true, selection),
    },
  ];

  it.each(cases)("$name: sends the hashes and reads the answer", async ({ url, value, send }) => {
    const { client, requests } = fakeServer(hashesAnswer);
    const answer = await send(client);
    expect(defined(requests[0])).toEqual({
      url: `${API}${url}`,
      method: "POST",
      body: { image_hashes: ["h1"], ...value },
    });
    expect(answer.count).toBe(1);
  });

  it.each(cases)("$name: sends a selected-all set as the query and its exclusions", async ({ url, value, send }) => {
    const { client, requests } = fakeServer({ status: true, count: 7 });
    const answer = await send(client, selectAll);
    expect(defined(requests[0])).toEqual({ url: `${API}${url}`, method: "POST", body: { ...selectAllBody, ...value } });
    expect(answer.count).toBe(7);
  });

  it("leaves out the exclusions when there are none", async () => {
    const { client, requests } = fakeServer({ status: true, count: 7 });
    await endpoints.setPhotosFavorite(client, [], true, { query: {} });
    expect(defined(requests[0]).body).toEqual({ select_all: true, query: {}, favorite: true });
  });

  it("reads the per-photo answers older servers sent", async () => {
    const { client } = fakeServer({ status: true, updated: [{ image_hash: "h1" }], not_updated: [] });
    expect((await endpoints.setPhotosHidden(client, ["h1"], true)).updated).toHaveLength(1);
  });

  it("deletes photos in the trash for good, by hash or selected-all", async () => {
    const byHash = { status: true, results: ["h1"], deleted: ["h1"], not_deleted: ["unknown"] };
    const hashes = fakeServer(byHash);
    expect(await endpoints.deletePhotos(hashes.client, ["h1", "unknown"])).toEqual(byHash);
    expect(defined(hashes.requests[0])).toEqual({
      url: `${API}/photosedit/delete/`,
      method: "DELETE",
      body: { image_hashes: ["h1", "unknown"] },
    });
    const all = fakeServer({ status: true, count: 3, failed_count: 0 });
    expect((await endpoints.deletePhotos(all.client, [], selectAll)).count).toBe(3);
    expect(defined(all.requests[0]).body).toEqual(selectAllBody);
  });

  it("fails loudly on a delete answer without the status flag", async () => {
    await expect(endpoints.deletePhotos(fakeServer({ count: 1 }).client, ["h1"])).rejects.toBeInstanceOf(
      ResponseParseError
    );
  });
});

describe("public photos", () => {
  const settings = {
    share_location: false,
    share_camera_info: true,
    share_timestamps: true,
    share_captions: false,
    share_faces: false,
  };

  it("reads a photo of a public album as its sharing settings let a visitor see it", async () => {
    const results = {
      image_hash: "h1",
      video: false,
      square_thumbnail_url: "/media/square_thumbnails/h1.webp",
      big_thumbnail_url: "/media/thumbnails_big/h1.webp",
      small_square_thumbnail_url: "/media/square_thumbnails_small/h1.webp",
      exif_timestamp: "2024-03-15T14:23:11Z",
      exif_gps_lat: null,
      exif_gps_lon: null,
      geolocation_json: null,
      search_location: "",
      camera: "FUJIFILM X-T4",
      lens: null,
      focal_length: 35,
      fstop: 2.8,
      iso: 400,
      shutter_speed: "1/250",
      width: 0,
      height: 0,
      search_captions: "",
      captions_json: { im2txt: "" },
      people: [],
    };
    const { client, requests } = fakeServer({ results, sharing_settings: settings });
    const answer = await endpoints.fetchPublicAlbumPhoto(client, "trip", "h1");
    expect(defined(requests[0]).url).toBe(`${API}/public/albums/s/trip/photos/h1/`);
    expect(answer.results.camera).toBe("FUJIFILM X-T4");
    expect(answer.sharing_settings).toEqual(settings);
  });

  it("creates, lists and reads a photo's public link", async () => {
    const share = {
      enabled: true,
      slug: "5b3Fk7vAH_yh",
      url: "/public/p/5b3Fk7vAH_yh",
      created_at: "2026-10-12T17:26:09Z",
    };
    const created = fakeServer({ status: true, share });
    expect(await endpoints.setPhotoShareLink(created.client, "h1", "enable")).toEqual(share);
    expect(defined(created.requests[0])).toEqual({
      url: `${API}/photo/share`,
      method: "POST",
      body: { photo_id: "h1", action: "enable" },
    });

    const listed = fakeServer({
      results: [{ ...share, photo_id: "ca38a897-9716-427a-b20d-6fafd5517edc", image_hash: "h1" }],
    });
    expect((await endpoints.fetchPhotoShareLinks(listed.client)).map(link => link.image_hash)).toEqual(["h1"]);
    expect(defined(listed.requests[0]).url).toBe(`${API}/photo/share/list`);

    const revoked = fakeServer({ status: true, share: { enabled: false, slug: null, url: null } });
    expect((await endpoints.setPhotoShareLink(revoked.client, "h1", "disable")).slug).toBeNull();
  });

  it("reads a photo shared by link, and rejects an unknown link with a 404", async () => {
    const shared = {
      video: false,
      exif_timestamp: null,
      search_location: "",
      camera: null,
      lens: null,
      search_captions: "",
      captions_json: { im2txt: "" },
      people: [],
      thumbnail_url: "/api/public/photo/a b/media/thumbnail/",
      video_url: null,
      video_playback_type: null,
    };
    const { client, requests } = fakeServer({ results: shared, sharing_settings: settings });
    expect((await endpoints.fetchSharedPhoto(client, "a b")).thumbnail_url).toBe(shared.thumbnail_url);
    expect(defined(requests[0]).url).toBe(`${API}/public/photo/a%20b/`);

    const gone = fakeServer({ errors: [{ field: "detail", message: "Not found.", code: "not_found" }] }, 404);
    const error: unknown = await endpoints.fetchSharedPhoto(gone.client, "x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404 });
  });

  /**
   * The public photo page decides from `video_playback_type` whether the browser can play a shared
   * video at all (the public endpoint never transcodes); zod strips keys a schema does not list.
   */
  it("keeps a shared video's playback type, null for stills, absent on older servers", () => {
    const video = { video: true, thumbnail_url: "/t/", video_url: "/v/" };
    const type = 'video/mp4; codecs="hvc1.2.4.L120.90"';
    expect(SharedPhoto.parse({ ...video, video_playback_type: type }).video_playback_type).toBe(type);
    expect(SharedPhoto.parse({ ...video, video_playback_type: null }).video_playback_type).toBeNull();
    expect(SharedPhoto.parse(video).video_playback_type).toBeUndefined();
  });
});
