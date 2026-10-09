import { describe, expect, it } from "vitest";
import dateAlbumsList from "./fixtures/dateAlbumsList.json";
import loginResponse from "./fixtures/loginResponse.json";
import userFixture from "./fixtures/user.json";
import {
  AutoAlbum,
  FetchDateAlbumsListResponse,
  FetchThingAlbumsListResponse,
  LoginResponse,
  Media,
  Photo,
  PhotosWithoutTimestampResponse,
  Photoset,
  SearchPhotos,
  User,
  UserAlbum,
  imageHashOf,
} from "../schemas";
import { photosetToFilter } from "../endpoints";

describe("schema parsing against fixtures", () => {
  it("parses a date-albums (timeline) list", () => {
    const parsed = FetchDateAlbumsListResponse.parse(dateAlbumsList);
    expect(parsed.results).toHaveLength(2);
    const first = parsed.results[0]!;
    expect(first.id).toBe("2024-06-15");
    expect(first.items[0]!.type).toBe(Media.IMAGE);
    // defaults applied by zod
    expect(first.items[0]!.isTemp).toBe(false);
    expect(first.items[0]!.shared_to).toEqual([]);
    // the null-date "no timestamp" bucket is allowed
    expect(parsed.results[1]!.date).toBeNull();
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
    expect(parsed.stack_raw_jpeg).toBe(true);
    expect(parsed.text_alignment).toBe("right");
    expect(parsed.duplicate_sensitivity).toBe("normal");
    expect(parsed.default_timeline_filter).toEqual({});
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
  it("extracts the image hash from a ;-delimited url", () => {
    expect(imageHashOf({ image_hash: "fallback", url: "realhash;variant" })).toBe("realhash");
    expect(imageHashOf({ image_hash: "fallback", url: undefined })).toBe("fallback");
  });

  it("maps photosets onto backend boolean filters", () => {
    expect(photosetToFilter(Photoset.FAVORITES).favorite).toBe(true);
    expect(photosetToFilter(Photoset.VIDEOS).video).toBe(true);
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
      big_thumbnail_url: null,
      small_square_thumbnail_url: null,
      geolocation_json: null,
      exif_json: null,
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
            { id: uuid(1), image_hash: "h1", is_primary: true, thumbnail_url: null, size: 1, width: null, height: null },
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
  });
});
