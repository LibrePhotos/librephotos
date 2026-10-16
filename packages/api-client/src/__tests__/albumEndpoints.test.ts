/**
 * The album endpoints the web and mobile apps share (issue #2347): the request each one sends and
 * the parsed answer, against the backend's answers.
 */
import { describe, expect, it } from "vitest";
import * as endpoints from "../endpoints";
import { Photoset } from "../schemas";
import { ResponseParseError } from "../util/parse";
import { defined } from "./defined";
import dateAlbumsList from "./fixtures/dateAlbumsList.json";
import folderSubfolders from "./fixtures/folderSubfolders.json";
import userAlbumCards from "./fixtures/userAlbumCards.json";
import { fakeServer, fakeServerByUrl } from "./harness";

const page = (results: unknown[]) => ({ count: results.length, next: null, previous: null, results });
const owner = { id: 1, username: "alice", first_name: "Alice", last_name: "" };
const card = defined(userAlbumCards[0]);

/** AlbumUserEditSerializer's answer to a create or a PATCH of /albums/user/edit/{id}/. */
const editedAlbum = {
  id: 4,
  title: "Berlin 2024",
  photos: ["11111111-1111-1111-1111-111111111111"],
  created_on: "2026-09-01T08:00:00Z",
  favorited: false,
  locked: false,
  cover_photo: null,
};

/**
 * The cover was a PhotoSuperSimple with a required `geolocation_json: z.unknown()`, which zod 4
 * rejects when absent, and PhotoSuperSimpleSerializer never sends it: every album list failed. An
 * album without a visible photo gets PhotoSuperSimpleSerializer(None).data as its cover
 * (AlbumUserListSerializer.get_cover_photo): image_hash "" and rating null. The shared lists do not
 * drop empty albums.
 */
describe("user album cards", () => {
  it("read the user album list as the server sends it", async () => {
    const { client, requests } = fakeServer(page([card]));
    const albums = await endpoints.fetchUserAlbumsList(client);
    expect(defined(requests[0]).url).toBe("https://demo.example.com/api/albums/user/list/");
    expect(defined(albums[0]).cover_photo).toEqual(card.cover_photo);
    expect(defined(albums[0]).locked).toBe(true);
  });

  it("read an album without photos in the shared-album lists", async () => {
    const byMe = await endpoints.fetchSharedAlbumsByMe(fakeServer(page(userAlbumCards)).client);
    expect(byMe.map(album => album.title)).toEqual(["Berlin 2024", "Still empty"]);
    expect(defined(byMe[1]).cover_photo).toMatchObject({ image_hash: "", rating: null });
    const withMe = await endpoints.fetchSharedAlbumsWithMe(fakeServer(page(userAlbumCards)).client);
    expect(withMe).toHaveLength(2);
  });

  it("keep reading a cover with only the hash and the video flag, and an album without the lock flag", async () => {
    const { locked: _locked, ...older } = card;
    const [album] = await endpoints.fetchUserAlbumsList(
      fakeServer(page([{ ...older, cover_photo: { image_hash: "h", video: true } }])).client
    );
    expect(defined(album).cover_photo).toEqual({ image_hash: "h", video: true });
    expect(defined(album).locked).toBe(false);
  });

  it("reads the date of an album's oldest photo, null without one and absent from an older server (#620)", async () => {
    const cards = [{ ...card, first_photo_date: "2015-06-01T12:00:00Z" }, { ...card, first_photo_date: null }, card];
    const [dated, undated, older] = await endpoints.fetchUserAlbumsList(fakeServer(page(cards)).client);
    expect(defined(dated).first_photo_date).toBe("2015-06-01T12:00:00Z");
    expect(defined(undated).first_photo_date).toBeNull();
    expect(defined(older).first_photo_date).toBeUndefined();
  });
});

describe("user album sharing", () => {
  it("shares an album and reads back its card", async () => {
    const { client, requests } = fakeServer(card);
    const album = await endpoints.setUserAlbumShared(client, "4", "2", true);
    expect(defined(requests[0])).toEqual({
      url: "https://demo.example.com/api/useralbum/share/",
      method: "POST",
      body: { album_id: "4", target_user_id: "2", shared: true },
    });
    expect(album.shared_to.map(user => user.username)).toEqual(["bob"]);
  });

  it("leaves an album shared with me", async () => {
    const { client, requests } = fakeServer(null);
    await expect(endpoints.leaveSharedAlbum(client, 4)).resolves.toBeUndefined();
    expect(defined(requests[0])).toEqual({
      url: "https://demo.example.com/api/useralbum/leave/",
      method: "POST",
      body: { album_id: "4" },
    });
  });

  it("makes an album public with its link settings, and leaves out what is not set", async () => {
    const { client, requests } = fakeServer({ status: true, album: card });
    const sharingOptions = { share_location: false, share_faces: true };
    const answer = await endpoints.setUserAlbumPublic(client, {
      albumId: "4",
      isPublic: true,
      slug: "berlin-2024",
      expiresAt: null,
      sharingOptions,
    });
    expect(defined(requests[0])).toEqual({
      url: "https://demo.example.com/api/useralbum/makepublic",
      method: "POST",
      body: { album_id: "4", val_public: true, slug: "berlin-2024", expires_at: null, sharing_options: sharingOptions },
    });
    expect(answer.album.public_slug).toBe("berlin-2024");

    const off = fakeServer({ status: true, album: { ...card, public: false } });
    await endpoints.setUserAlbumPublic(off.client, { albumId: 4, isPublic: false });
    expect(defined(off.requests[0]).body).toEqual({ album_id: "4", val_public: false });
  });
});

describe("public albums", () => {
  const publicAlbum = {
    id: "4",
    title: "Berlin 2024",
    owner,
    date: "2024-06-15",
    location: "Berlin",
    grouped_photos: [],
    public_slug: "berlin-2024",
    public_expires_at: null,
  };

  it("reads a public album by its slug", async () => {
    const { client, requests } = fakeServer({ results: publicAlbum });
    const album = await endpoints.fetchPublicAlbum(client, "a b/c");
    expect(defined(requests[0]).url).toBe("https://demo.example.com/api/public/albums/s/a%20b%2Fc/");
    expect(album).toMatchObject({ id: 4, title: "Berlin 2024", locked: false });
  });

  it("reads only the id for a slug check, and throws a ResponseParseError without one", async () => {
    await expect(endpoints.fetchPublicAlbumSlugOwner(fakeServer({ results: publicAlbum }).client, "s")).resolves.toBe(
      4
    );
    await expect(
      endpoints.fetchPublicAlbumSlugOwner(fakeServer({ results: { title: "x" } }).client, "s")
    ).rejects.toBeInstanceOf(ResponseParseError);
  });
});

describe("user album edits", () => {
  it("creates an album from photo ids", async () => {
    const { client, requests } = fakeServer(editedAlbum);
    await expect(endpoints.createUserAlbum(client, "Berlin 2024", ["p1"])).resolves.toMatchObject({ id: 4 });
    expect(defined(requests[0])).toEqual({
      url: "https://demo.example.com/api/albums/user/edit/",
      method: "POST",
      body: { title: "Berlin 2024", photos: ["p1"] },
    });
  });

  it("sends a selected-all set as its query and exclusions instead of photo ids", async () => {
    const { client, requests } = fakeServer(editedAlbum);
    await endpoints.createUserAlbum(client, "All", ["ignored"], { query: { favorite: true }, excludedHashes: ["h1"] });
    await endpoints.addPhotosToUserAlbum(client, "4", "All", [], {});
    expect(defined(requests[0]).body).toEqual({
      title: "All",
      photos: [],
      select_all: true,
      query: { favorite: true },
      excluded_hashes: ["h1"],
    });
    expect(defined(requests[1])).toEqual({
      url: "https://demo.example.com/api/albums/user/edit/4/",
      method: "PATCH",
      body: { title: "All", photos: [], select_all: true, query: {}, excluded_hashes: [] },
    });
  });

  it("adds, removes, sets the cover and locks through the edit view", async () => {
    const { client, requests } = fakeServer(editedAlbum);
    await endpoints.addPhotosToUserAlbum(client, 4, "Berlin 2024", ["p1"]);
    await endpoints.removePhotosFromUserAlbum(client, "4", ["h1"]);
    await endpoints.setUserAlbumCover(client, "4", "h2");
    await expect(endpoints.setUserAlbumLocked(client, "4", true)).resolves.toMatchObject({ id: 4 });
    expect(requests.map(({ method, body }) => ({ method, body }))).toEqual([
      { method: "PATCH", body: { title: "Berlin 2024", photos: ["p1"] } },
      { method: "PATCH", body: { removedPhotos: ["h1"] } },
      { method: "PATCH", body: { cover_photo: "h2" } },
      { method: "PATCH", body: { locked: true } },
    ]);
    expect(new Set(requests.map(request => request.url))).toEqual(
      new Set(["https://demo.example.com/api/albums/user/edit/4/"])
    );
  });

  it("renames through the album view, whose id is still a string", async () => {
    const { client, requests } = fakeServer({ ...editedAlbum, id: "4", title: "Berlin", owner, grouped_photos: [] });
    await expect(endpoints.renameUserAlbum(client, "4", "Berlin")).resolves.toMatchObject({ id: 4, title: "Berlin" });
    expect(defined(requests[0])).toEqual({
      url: "https://demo.example.com/api/albums/user/4/",
      method: "PATCH",
      body: { title: "Berlin" },
    });
  });

  it("picks an event's cover and goes back to the automatic one", async () => {
    const cover = "11111111-1111-1111-1111-111111111111";
    const { client, requests } = fakeServer({ id: 7, cover_photo: cover });
    await expect(endpoints.setAutoAlbumCover(client, 7, cover)).resolves.toEqual({ id: 7, cover_photo: cover });
    const automatic = fakeServer({ id: 7, cover_photo: null });
    await expect(endpoints.setAutoAlbumCover(automatic.client, "7", null)).resolves.toEqual({
      id: 7,
      cover_photo: null,
    });
    expect([...requests, ...automatic.requests]).toEqual([
      { url: "https://demo.example.com/api/albums/auto/7/", method: "PATCH", body: { cover_photo: cover } },
      { url: "https://demo.example.com/api/albums/auto/7/", method: "PATCH", body: { cover_photo: null } },
    ]);
  });

  it("deletes a user album, an event album and every event album", async () => {
    const { client, requests } = fakeServer(null);
    await endpoints.deleteUserAlbum(client, "4");
    await endpoints.deleteAutoAlbum(client, 7);
    expect(requests.map(({ url, method }) => `${method} ${url}`)).toEqual([
      "DELETE https://demo.example.com/api/albums/user/4/",
      "DELETE https://demo.example.com/api/albums/auto/7/",
    ]);
    const all = fakeServer("success");
    await expect(endpoints.deleteAllAutoAlbums(all.client)).resolves.toBe("success");
    expect(defined(all.requests[0])).toMatchObject({
      url: "https://demo.example.com/api/albums/auto/delete_all/",
      method: "POST",
    });
  });
});

describe("people", () => {
  const person = {
    name: "Ann",
    face_url: "/media/faces/1.jpg",
    face_count: 3,
    face_photo_url: "hash1",
    video: false,
    id: 5,
  };

  it("reads every person, with a bigger page when asked", async () => {
    const { client, requests } = fakeServer(page([person, { ...person, id: 6, face_photo_url: null }]));
    const people = await endpoints.fetchPeopleAlbums(client, { pageSize: 1000 });
    expect(defined(requests[0]).url).toBe("https://demo.example.com/api/persons/?page_size=1000");
    expect(people.map(row => row.id)).toEqual([5, 6]);
    const plain = fakeServer(page([person]));
    await endpoints.fetchPeopleAlbums(plain.client);
    expect(defined(plain.requests[0]).url).toBe("https://demo.example.com/api/persons/");
  });

  it("renames, sets the cover and deletes a person", async () => {
    const { client, requests } = fakeServer(person);
    await expect(endpoints.renamePerson(client, "5", "Ann")).resolves.toMatchObject({ id: 5, name: "Ann" });
    await endpoints.setPersonCover(client, 5, "h2");
    expect(requests.map(({ url, method, body }) => ({ url, method, body }))).toEqual([
      { url: "https://demo.example.com/api/persons/5/", method: "PATCH", body: { newPersonName: "Ann" } },
      { url: "https://demo.example.com/api/persons/5/", method: "PATCH", body: { cover_photo: "h2" } },
    ]);
    const deleted = fakeServer(null);
    await endpoints.deletePerson(deleted.client, "5");
    expect(defined(deleted.requests[0])).toMatchObject({
      url: "https://demo.example.com/api/persons/5/",
      method: "DELETE",
    });
  });
});

describe("person page", () => {
  it("reads one person", async () => {
    const { client, requests } = fakeServer({
      name: "Ann",
      face_url: "",
      face_count: 0,
      face_photo_url: "",
      video: false,
      id: 5,
    });
    await expect(endpoints.fetchPerson(client, 5)).resolves.toMatchObject({ id: 5, name: "Ann" });
    expect(defined(requests[0])).toMatchObject({ url: "https://demo.example.com/api/persons/5/", method: "GET" });
  });

  it("takes a person off photos by id", async () => {
    const { client, requests } = fakeServer({ removed: 3, photo_count: 2, write_error: null });
    const ids = ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"];
    await expect(endpoints.removePhotosFromPerson(client, "5", ids)).resolves.toEqual({
      removed: 3,
      photo_count: 2,
      write_error: null,
    });
    expect(defined(requests[0])).toMatchObject({
      url: "https://demo.example.com/api/persons/5/remove-photos/",
      method: "POST",
      body: { photo_ids: ids },
    });
  });

  it("refuses an answer without the counts", async () => {
    const { client } = fakeServer({ removed: 3 });
    await expect(endpoints.removePhotosFromPerson(client, 5, [])).rejects.toBeInstanceOf(ResponseParseError);
  });

  it("merges a person into another, sending the merged one's id as a number", async () => {
    const { client, requests } = fakeServer({ moved: 4, photo_count: 3, write_queued: true });
    await expect(endpoints.mergePerson(client, "5", "9")).resolves.toEqual({
      moved: 4,
      photo_count: 3,
      write_queued: true,
    });
    expect(defined(requests[0])).toMatchObject({
      url: "https://demo.example.com/api/persons/5/merge/",
      method: "POST",
      body: { person: 9 },
    });
  });

  it("refuses a merge answer without the write flag", async () => {
    const { client } = fakeServer({ moved: 4, photo_count: 3 });
    await expect(endpoints.mergePerson(client, 5, 9)).rejects.toBeInstanceOf(ResponseParseError);
  });
});

describe("places and folders", () => {
  it("reads the location clusters", async () => {
    const clusters = [
      [52.52, 13.4, "Berlin"],
      [48.85, 2.35, "Paris"],
    ];
    const { client, requests } = fakeServer(clusters);
    await expect(endpoints.fetchLocationClusters(client)).resolves.toEqual(clusters);
    expect(defined(requests[0]).url).toBe("https://demo.example.com/api/locclust/");
  });

  it("reads a page of subfolders, of the scan directory or of a path", async () => {
    const { client, requests } = fakeServer(folderSubfolders);
    const listing = await endpoints.fetchFolderSubfolders(client);
    await endpoints.fetchFolderSubfolders(client, { path: "/data/My Photos", page: 2 });
    expect(requests.map(request => request.url)).toEqual([
      "https://demo.example.com/api/folders/subfolders/",
      "https://demo.example.com/api/folders/subfolders/?path=%2Fdata%2FMy+Photos&page=2",
    ]);
    expect(listing.results.map(folder => folder.name)).toEqual(["2023", "2024"]);
    expect(defined(listing.results[1]).cover_photo).toEqual({ image_hash: "h2024", video: true });
    // The copies kept for older web bundles are not read.
    expect(listing).not.toHaveProperty("subfolders");
  });

  it("reads every subfolder of a path, following next, with the folder's paths", async () => {
    const pageOne = {
      ...folderSubfolders,
      next: "http://backend:8001/api/folders/subfolders/?page=2&path=%2Fdata%2Fphotos",
      count: 3,
      num_pages: 2,
    };
    const later = { name: "2025", path: "/data/photos/2025", photo_count: 3, modified: 1737373737 };
    const pageTwo = { ...folderSubfolders, results: [later], subfolders: [later], previous: "x", page: 2, count: 3 };
    const { client, requests } = fakeServerByUrl(url => (url.includes("page=2") ? pageTwo : pageOne));
    const listing = await endpoints.fetchAllFolderSubfolders(client, { path: "/data/photos" });
    // The server's host in `next` is not followed, only its query
    expect(requests.map(request => request.url)).toEqual([
      "https://demo.example.com/api/folders/subfolders/?path=%2Fdata%2Fphotos",
      "https://demo.example.com/api/folders/subfolders/?page=2&path=%2Fdata%2Fphotos",
    ]);
    expect(listing).toEqual({
      current_path: "/data/photos",
      parent_path: null,
      results: [...folderSubfolders.results, later],
    });
  });

  it("reads the empty listing of a user without a scan directory", async () => {
    const empty = { ...folderSubfolders, current_path: null, parent_path: null, results: [], count: 0, num_pages: 1 };
    await expect(endpoints.fetchFolderSubfolders(fakeServer(empty).client)).resolves.toMatchObject({
      current_path: null,
      results: [],
    });
  });
});

describe("date albums with the timeline filter", () => {
  it("sends the timeline filter and the photoset flags, and leaves out media=all", async () => {
    const { client, requests } = fakeServer(dateAlbumsList);
    await endpoints.fetchDateAlbumsList(client, {
      favorite: true,
      media: "photos",
      hide_screenshots: true,
      hide_documents: false,
      person: 3,
      username: "Alice",
      folder: "",
    });
    const dayServer = fakeServer({ results: defined(dateAlbumsList.results[0]) });
    await endpoints.fetchDateAlbum(dayServer.client, 12, 2, { media: "all", hide_documents: true });
    const list = new URL(defined(requests[0]).url);
    const day = new URL(defined(dayServer.requests[0]).url);
    expect(list.pathname).toBe("/api/albums/date/list/");
    expect(Object.fromEntries(list.searchParams)).toEqual({
      favorite: "true",
      media: "photos",
      hide_screenshots: "true",
      person: "3",
      username: "alice",
    });
    expect(day.pathname).toBe("/api/albums/date/12/");
    expect(Object.fromEntries(day.searchParams)).toEqual({ hide_documents: "true", page: "2" });
  });

  it("sends archived as a tri-state flag (#545)", async () => {
    const params = async (filter: endpoints.DateAlbumFilter) => {
      const { client, requests } = fakeServer(dateAlbumsList);
      await endpoints.fetchDateAlbumsList(client, filter);
      return Object.fromEntries(new URL(defined(requests[0]).url).searchParams);
    };
    expect(await params({ archived: false })).toEqual({ archived: "false" });
    expect(await params(endpoints.photosetToFilter(Photoset.ARCHIVED))).toEqual({ archived: "true" });
    expect(await params({})).toEqual({});
  });
});

/** AlbumCollectionViewSet and AlbumUserViewSet.collections (#1009). */
describe("album collections", () => {
  it("reads every page of the collections", async () => {
    const { client, requests } = fakeServer(page([{ id: 3, name: "Travel" }]));
    await expect(endpoints.fetchAlbumCollections(client)).resolves.toEqual([{ id: 3, name: "Travel" }]);
    expect(defined(requests[0]).url).toBe("https://demo.example.com/api/albums/collections/");
  });

  it("creates, renames and deletes a collection", async () => {
    const created = fakeServer({ id: 3, name: "Travel" });
    await expect(endpoints.createAlbumCollection(created.client, "Travel")).resolves.toEqual({ id: 3, name: "Travel" });
    expect(defined(created.requests[0])).toEqual({
      url: "https://demo.example.com/api/albums/collections/",
      method: "POST",
      body: { name: "Travel" },
    });

    const renamed = fakeServer({ id: 3, name: "Trips" });
    await endpoints.renameAlbumCollection(renamed.client, 3, "Trips");
    expect(defined(renamed.requests[0])).toEqual({
      url: "https://demo.example.com/api/albums/collections/3/",
      method: "PATCH",
      body: { name: "Trips" },
    });

    const deleted = fakeServer(null);
    await endpoints.deleteAlbumCollection(deleted.client, 3);
    expect(defined(deleted.requests[0])).toMatchObject({
      url: "https://demo.example.com/api/albums/collections/3/",
      method: "DELETE",
    });
  });

  it("puts an album in exactly the given collections", async () => {
    const { client, requests } = fakeServer({ collection_ids: [3, 5] });
    await expect(endpoints.setUserAlbumCollections(client, "4", [3, 5])).resolves.toEqual({ collection_ids: [3, 5] });
    expect(defined(requests[0])).toEqual({
      url: "https://demo.example.com/api/albums/user/4/collections/",
      method: "PUT",
      body: { collection_ids: [3, 5] },
    });
  });

  it("reads the collections of an album card, and none from an older server", async () => {
    const [filed, older] = await endpoints.fetchUserAlbumsList(
      fakeServer(page([{ ...card, collection_ids: [3] }, card])).client
    );
    expect(defined(filed).collection_ids).toEqual([3]);
    expect(defined(older).collection_ids).toEqual([]);
  });
});
