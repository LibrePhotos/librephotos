import { UserAlbumInfo as SharedUserAlbumInfo } from "@librephotos/api-client";
import { describe, expect, it } from "vitest";
import { UserAlbum, UserAlbumInfo } from "./types";

const publicAlbum = {
  id: "867",
  title: "Trip",
  owner: { id: 1, username: "owner", first_name: "", last_name: "" },
  date: "",
  location: "",
  grouped_photos: [],
};
describe("user album lock responses", () => {
  it("keeps public album responses without a lock flag readable", () => {
    expect(UserAlbum.parse(publicAlbum).locked).toBe(false);
  });
  it("preserves an authenticated album's lock state", () => {
    expect(UserAlbum.parse({ ...publicAlbum, locked: true }).locked).toBe(true);
  });
  it.each([UserAlbumInfo, SharedUserAlbumInfo])("preserves the lock state in album info schemas (%#)", schema => {
    const album = {
      id: 867,
      title: "Trip",
      cover_photo: null,
      photo_count: 3,
      owner: publicAlbum.owner,
      shared_to: [],
      created_on: "2026-10-05T00:00:00Z",
      favorited: false,
      locked: true,
    };
    expect(schema.parse(album).locked).toBe(true);
  });
  it("accepts lightweight list cover photos without losing the lock state", () => {
    const album = UserAlbumInfo.parse({
      id: 867,
      title: "Trip",
      cover_photo: { image_hash: "photo-hash", video: false },
      photo_count: 3,
      owner: publicAlbum.owner,
      shared_to: [],
      created_on: "2026-10-05T00:00:00Z",
      favorited: false,
      locked: true,
    });
    expect(album.cover_photo).toEqual({ image_hash: "photo-hash", video: false });
    expect(album.locked).toBe(true);
  });
  it("parses album lists from servers that predate the lock flag", () => {
    const album = {
      id: 867,
      title: "Trip",
      cover_photo: null,
      photo_count: 3,
      owner: publicAlbum.owner,
      shared_to: [],
      created_on: "2026-10-05T00:00:00Z",
      favorited: false,
    };
    expect(SharedUserAlbumInfo.parse(album).locked).toBe(false);
    expect(UserAlbumInfo.parse(album).locked).toBeFalsy();
  });
});
