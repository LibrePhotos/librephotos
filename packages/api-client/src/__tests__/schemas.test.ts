import { describe, expect, it } from "vitest";
import { photosetToFilter } from "../endpoints";
import {
  AutoAlbum,
  CreateUserAlbumResponse,
  FetchDateAlbumsListResponse,
  FetchThingAlbumsListResponse,
  imageHashOf,
  IntegerId,
  LoginResponse,
  Media,
  Photo,
  Photoset,
  PhotosWithoutTimestampResponse,
  PigPhoto,
  SearchPhotos,
  SetFacesLabelResponse,
  SyncPhotosResponse,
  User,
  UserAlbum,
} from "../schemas";
import { defined } from "./defined";
import dateAlbumsList from "./fixtures/dateAlbumsList.json";
import loginResponse from "./fixtures/loginResponse.json";
import userFixture from "./fixtures/user.json";

describe("IntegerId", () => {
  it("reads an integer key sent as a number or as a string, and gives a number", () => {
    expect(IntegerId.parse(12)).toBe(12);
    expect(IntegerId.parse("12")).toBe(12);
  });

  it("rejects anything that is not an integer key", () => {
    for (const value of ["", "12a", "2024-06-15", "1.5", 1.5, null, undefined, true]) {
      expect(IntegerId.safeParse(value).success, String(value)).toBe(false);
    }
  });
});

describe("schema parsing against fixtures", () => {
  it("parses a date-albums (timeline) list", () => {
    const parsed = FetchDateAlbumsListResponse.parse(dateAlbumsList);
    expect(parsed.results).toHaveLength(2);
    const first = defined(parsed.results[0]);
    // Servers up to 1.3 send the date album id as a string, later ones as a number.
    expect(first.id).toBe(12);
    expect(defined(parsed.results[1]).id).toBe(13);
    expect(defined(first.items[0]).type).toBe(Media.IMAGE);
    // defaults applied by zod
    expect(defined(first.items[0]).isTemp).toBe(false);
    expect(defined(first.items[0]).shared_to).toEqual([]);
    // the null-date "no timestamp" bucket is allowed
    expect(defined(parsed.results[1]).date).toBeNull();
  });

  it("parses a login response", () => {
    const parsed = LoginResponse.parse(loginResponse);
    expect(parsed.access).toContain("eyJ");
    expect(parsed.refresh).toBe("refresh-token-value");
  });

  it("parses a full user record", () => {
    const parsed = User.parse(userFixture);
    expect(parsed.username).toBe("admin");
    // schema defaults for fields the fixture omits
    expect(parsed.text_alignment).toBe("right");
    expect(parsed.duplicate_sensitivity).toBe("normal");
    expect(parsed.default_timeline_filter).toEqual({});
  });

  // #2202: servers before the rating style setting do not send it.
  it("reads a user without rating_mode as favorite mode", () => {
    expect(User.parse(userFixture).rating_mode).toBe("favorite");
    expect(User.parse({ ...userFixture, rating_mode: "stars" }).rating_mode).toBe("stars");
  });

  // #2219: read-only and unused; the server stops sending them once the
  // columns are dropped, so they get no default and may be missing.
  it("parses a user record with and without the deprecated RAW flags", () => {
    expect(User.parse(userFixture).stack_raw_jpeg).toBeUndefined();
    const withFlags = User.parse({ ...userFixture, skip_raw_files: false, stack_raw_jpeg: true });
    expect(withFlags.skip_raw_files).toBe(false);
    expect(withFlags.stack_raw_jpeg).toBe(true);
  });

  // #2196: the server stops sending these once the fields are dropped; a
  // released mobile build must still parse the user.
  it("parses a user record without the unused face confidence fields", () => {
    const withoutFaceFields: Record<string, unknown> = { ...userFixture };
    delete withoutFaceFields.confidence_person;
    delete withoutFaceFields.confidence_unknown_face;
    const parsed = User.parse(withoutFaceFields);
    expect(parsed.username).toBe("admin");
    expect(parsed.confidence_person).toBeUndefined();
    expect(parsed.confidence_unknown_face).toBeUndefined();
  });

  // #2305: an older server sends neither, and the web app then shows no What's new card.
  it("parses a user record with and without the What's new fields", () => {
    expect(User.parse(userFixture).last_seen_release).toBeUndefined();
    expect(User.parse(userFixture).show_whats_new).toBeUndefined();
    const parsed = User.parse({ ...userFixture, last_seen_release: "1.5.0", show_whats_new: false });
    expect(parsed.last_seen_release).toBe("1.5.0");
    expect(parsed.show_whats_new).toBe(false);
  });

  it("keeps the valid keys of a saved timeline filter and drops the rest", () => {
    const parsed = User.parse({
      ...userFixture,
      default_timeline_filter: { media: "photos", hide_screenshots: "yes", favorites: true },
    });
    expect(parsed.default_timeline_filter).toEqual({ media: "photos", favorites: true });
  });

  it("never fails a user over a saved timeline filter that is not an object", () => {
    const parsed = User.parse({ ...userFixture, default_timeline_filter: null });
    expect(parsed.default_timeline_filter).toEqual({});
  });

  it("reads an unknown category_source as automatic", () => {
    expect(Photo.shape.category_source.parse("garbage")).toBe("auto");
    expect(Photo.shape.category_source.parse(undefined)).toBe("auto");
    expect(Photo.shape.category_source.parse("user")).toBe("user");
  });

  // zod strips unknown keys; the web Edit User dialog lost the upload folder.
  it("keeps a user's upload folder, which may be empty or null", () => {
    expect(User.parse({ ...userFixture, upload_directory: "/data/photos/inbox" }).upload_directory).toBe(
      "/data/photos/inbox"
    );
    expect(User.parse({ ...userFixture, upload_directory: null }).upload_directory).toBeNull();
    expect(User.parse(userFixture).upload_directory).toBeUndefined();
  });

  // Search sends "No timestamp" for the undated group today and may send null,
  // as the other grouped lists do; a null used to fail the whole search.
  it("parses search date groups with either undated marker", () => {
    const group = (date: string | null) => ({ date, location: "", items: [] });
    const parsed = SearchPhotos.parse({ results: [group("2024-06-15"), group("No timestamp"), group(null)] });
    expect(parsed.results.map(g => g.date)).toEqual(["2024-06-15", "No timestamp", null]);
  });

  it("rejects malformed data loudly (server drift)", () => {
    const bad = { results: [{ id: 5, items: "not-an-array" }] };
    expect(() => FetchDateAlbumsListResponse.parse(bad)).toThrow();
  });
});

describe("helpers", () => {
  it("reads the image hash from image_hash, never from the legacy url (#493)", () => {
    expect(imageHashOf({ image_hash: "realhash" })).toBe("realhash");
    const parsed = PigPhoto.parse({
      id: "11111111-2222-3333-4444-555555555555",
      image_hash: "realhash",
      url: "other;x",
      aspectRatio: 1,
    });
    expect(imageHashOf(parsed)).toBe("realhash");
  });

  it("maps photosets onto backend boolean filters", () => {
    expect(photosetToFilter(Photoset.FAVORITES).favorite).toBe(true);
    expect(photosetToFilter(Photoset.VIDEOS).video).toBe(true);
    expect(photosetToFilter(Photoset.DOCUMENTS).is_document).toBe(true);
    expect(photosetToFilter(Photoset.SCREENSHOTS).is_document).toBeUndefined();
    expect(photosetToFilter(Photoset.TIMESTAMP).favorite).toBeUndefined();
  });
});

/**
 * Fields the web frontend reads that the shared schemas used to drop (zod
 * strips unknown keys, so a missing field silently vanishes from the data).
 */
describe("fields shared with the web frontend", () => {
  const owner = { id: 1, username: "admin", first_name: "", last_name: "" };
  const uuid = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

  it("keeps a photo's file variants and stacks", () => {
    const photo = Photo.parse({
      id: uuid(1),
      camera: null,
      exif_gps_lat: null,
      exif_gps_lon: null,
      exif_timestamp: null,
      search_captions: null,
      search_location: null,
      captions_json: null,
      big_thumbnail_url: "",
      small_square_thumbnail_url: "",
      geolocation_json: null,
      people: [],
      image_hash: "h1",
      image_path: ["/data/a.jpg"],
      rating: 0,
      hidden: false,
      public: false,
      in_trashcan: false,
      removed: false,
      size: 1,
      shared_to: [],
      similar_photos: [],
      video: false,
      owner,
      shutter_speed: null,
      height: null,
      width: null,
      fstop: null,
      iso: null,
      focal_length: null,
      focalLength35Equivalent: null,
      subjectDistance: null,
      digitalZoomRatio: null,
      lens: null,
      embedded_media: [],
      file_variants: [{ hash: "h1", path: "/data/a.raw", type: "raw", type_id: 3, is_main: false, filename: "a.raw" }],
      stacks: [
        {
          id: uuid(2),
          type: "burst",
          type_display: "Burst",
          photo_count: 1,
          is_primary: true,
          photos: [
            {
              id: uuid(1),
              image_hash: "h1",
              is_primary: true,
              thumbnail_url: null,
              size: 1,
              width: null,
              height: null,
            },
          ],
        },
      ],
    });
    expect(photo.file_variants?.[0]?.type).toBe("raw");
    expect(photo.stacks?.[0]?.photos[0]?.image_hash).toBe("h1");
  });

  it("requires the DRF pagination fields on the no-timestamp list", () => {
    expect(PhotosWithoutTimestampResponse.parse({ count: 0, next: null, previous: null, results: [] }).count).toBe(0);
    expect(() => PhotosWithoutTimestampResponse.parse({ results: [] })).toThrow();
  });

  it("keeps a thing album's thing_type, which may be null", () => {
    const parsed = FetchThingAlbumsListResponse.parse({
      results: [
        { id: 1, title: "#beach", cover_photos: [], photo_count: 2, thing_type: "hashtag_attribute" },
        { id: 2, title: "dog", cover_photos: [], photo_count: 1, thing_type: null },
      ],
    });
    expect(parsed.results.map(album => album.thing_type)).toEqual(["hashtag_attribute", null]);
  });

  it("keeps an auto album's people and photo ids", () => {
    const album = AutoAlbum.parse({
      id: 3,
      title: "Trip",
      favorited: false,
      timestamp: "2024-01-01T00:00:00Z",
      created_on: "2024-01-02T00:00:00Z",
      gps_lat: null,
      gps_lon: null,
      people: [{ id: 4, name: "Ann", face_url: null, face_count: 2, face_photo_url: null }],
      photos: [
        {
          id: uuid(5),
          square_thumbnail: "/media/square_thumbnails/h5",
          image_hash: "h5",
          exif_timestamp: "2024-01-01T00:00:00Z",
          exif_gps_lat: null,
          exif_gps_lon: null,
          rating: 0,
          geolocation_json: {},
          public: false,
          video: false,
        },
      ],
    });
    expect(album.people[0]?.name).toBe("Ann");
    expect(album.photos[0]?.id).toBe(uuid(5));
  });

  it("keeps a user album's public sharing overrides", () => {
    const album = UserAlbum.parse({
      id: "7",
      title: "Public",
      owner,
      date: "2024-01-01",
      location: null,
      grouped_photos: [],
      public: true,
      public_sharing_options: { share_location: false, share_faces: null },
    });
    expect(album.public_sharing_options).toEqual({ share_location: false, share_faces: null });
    expect(album.id).toBe(7);
  });
});

describe("loose objects keep the fields a newer server adds", () => {
  const photoRow = {
    id: "3f2c1a4e-0b5d-4c7e-9a1f-2d3e4f5a6b7c",
    image_hash: "abc123",
    owner_id: 1,
    timestamp: 1718409600000,
    added_on: 1718409600000,
    last_modified: 1718409600000,
    type: "image",
    video_length_ms: null,
    rating: 0,
    is_favorite: false,
    hidden: false,
    in_trashcan: false,
    removed: false,
    is_public: false,
    aspect_ratio: 1.5,
    latitude: null,
    longitude: null,
    search_location: "",
    dominant_color: null,
  };

  it("keeps unknown keys on a sync envelope and its items", () => {
    const parsed = SyncPhotosResponse.parse({
      v: 1,
      items: [{ ...photoRow, future_field: "kept" }],
      tombstones: [42],
      next_cursor: null,
      server_time: "2024-06-15T00:00:00Z",
      future_envelope_field: true,
    });
    expect(defined(parsed.items[0]).future_field).toBe("kept");
    expect(parsed.future_envelope_field).toBe(true);
    // numeric tombstones are coerced to the string ids the client stores
    expect(parsed.tombstones).toEqual(["42"]);
  });

  it("keeps unknown keys on face and mutation responses", () => {
    const faces = SetFacesLabelResponse.parse({ status: true, results: [{ id: 7, cluster: 3 }], extra: "x" });
    expect(faces.extra).toBe("x");
    expect(defined(faces.results[0]).cluster).toBe(3);
    expect(faces.updated).toEqual([]);
    expect(CreateUserAlbumResponse.parse({ id: 9, photos: [] }).photos).toEqual([]);
  });

  it("still rejects a sync payload with the wrong version", () => {
    expect(() => SyncPhotosResponse.parse({ v: 2, items: [], next_cursor: null, server_time: "" })).toThrow();
  });

  it("reads a photo's media type, defaults it to image and rejects an unknown one", () => {
    const tile = { id: "3f2c1a4e-0b5d-4c7e-9a1f-2d3e4f5a6b7c", image_hash: "abc", aspectRatio: 1 };
    expect(PigPhoto.parse({ ...tile, type: "motion_photo" }).type).toBe(Media.MOTION_PHOTO);
    expect(PigPhoto.parse(tile).type).toBe(Media.IMAGE);
    expect(PigPhoto.safeParse({ ...tile, type: "hologram" }).success).toBe(false);
  });
});
