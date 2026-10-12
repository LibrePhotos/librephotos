/**
 * The album endpoints the web and mobile apps share (issue #2347): the request each one sends and
 * the parsed answer, against the backend's answers.
 */
import { describe, expect, it } from "vitest";
import * as endpoints from "../endpoints";
import { defined } from "./defined";
import userAlbumCards from "./fixtures/userAlbumCards.json";
import { fakeServer } from "./harness";

const page = (results: unknown[]) => ({ count: results.length, next: null, previous: null, results });

/**
 * The cover was a PhotoSuperSimple with a required `geolocation_json: z.unknown()`, which zod 4
 * rejects when absent, and PhotoSuperSimpleSerializer never sends it: every album list failed. An
 * album without a visible photo gets PhotoSuperSimpleSerializer(None).data as its cover
 * (AlbumUserListSerializer.get_cover_photo): image_hash "" and rating null. The shared lists do not
 * drop empty albums.
 */
describe("user album cards", () => {
  it("read the user album list as the server sends it", async () => {
    const { client, requests } = fakeServer(page(userAlbumCards.slice(0, 1)));
    const albums = await endpoints.fetchUserAlbumsList(client);
    expect(defined(requests[0]).url).toBe("https://demo.example.com/api/albums/user/list/");
    expect(defined(albums[0]).cover_photo).toEqual(defined(userAlbumCards[0]).cover_photo);
    expect(defined(albums[0]).locked).toBe(true);
  });

  it("read an album without photos in the shared-album lists", async () => {
    const byMe = await endpoints.fetchSharedAlbumsByMe(fakeServer(page(userAlbumCards)).client);
    expect(byMe.map(album => album.title)).toEqual(["Berlin 2024", "Still empty"]);
    expect(defined(byMe[1]).cover_photo).toMatchObject({ image_hash: "", rating: null });
    const withMe = await endpoints.fetchSharedAlbumsWithMe(fakeServer(page(userAlbumCards)).client);
    expect(withMe).toHaveLength(2);
  });
});
