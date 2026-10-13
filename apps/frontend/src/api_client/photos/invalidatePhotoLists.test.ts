/**
 * Favouriting, hiding or trashing photos only refreshed the timeline queries,
 * so album, event, place, thing, tag, search, no-timestamp and shared grids
 * kept the old stars and kept showing trashed photos until a reload. Every
 * grid now sits under photoGridKeys.all.
 */
import { photoGridKeys, photoKeys, Photoset } from "@librephotos/api-client";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { invalidatePhotoLists } from "./invalidatePhotoLists";

describe("invalidatePhotoLists", () => {
  it("marks every photo grid stale, and nothing else", () => {
    const client = new QueryClient();
    const grids = [
      photoGridKeys.dateAlbumList([Photoset.FAVORITES, 3, "alice", "/photos", "videos", "media=photos"]),
      photoGridKeys.dateAlbumDay([Photoset.NONE, undefined, undefined, undefined, "all", ""], 12, 2),
      photoGridKeys.recentlyAddedView("videos"),
      photoGridKeys.userAlbumView("7", true, "alice", "photos"),
      photoGridKeys.publicAlbum("summer"),
      photoGridKeys.autoAlbum("8"),
      photoGridKeys.placeAlbum("9", "all"),
      photoGridKeys.thingsAlbum("10", "all"),
      photoGridKeys.tagAlbumView("11", "all"),
      photoGridKeys.search("beach", "all", "semantic"),
      photoGridKeys.withoutTimestamp(1, "documents"),
      photoGridKeys.sharedByMe(),
      photoGridKeys.sharedWithMe(),
    ];
    const details = photoKeys.detail("abc");
    [...grids, details].forEach(queryKey => client.setQueryData(queryKey, []));

    invalidatePhotoLists(client);

    grids.forEach(queryKey => expect(client.getQueryState(queryKey)?.isInvalidated, String(queryKey)).toBe(true));
    expect(client.getQueryState(details)?.isInvalidated).toBe(false);
  });
});
