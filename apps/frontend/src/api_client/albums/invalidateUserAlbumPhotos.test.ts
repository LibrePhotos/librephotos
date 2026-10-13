/**
 * Adding photos to an album (or removing them, or creating or deleting an album) changes which
 * photos are in none of my albums, so the "Not in an album" list refetches too (#530).
 */
import { albumKeys, photoGridKeys } from "@librephotos/api-client";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { invalidateUserAlbumPhotos } from "./invalidateUserAlbumPhotos";

const keys = {
  albums: albumKeys.userAlbums(),
  album7: photoGridKeys.userAlbumView("7", false, "", "all"),
  album8: photoGridKeys.userAlbumView("8", false, "", "all"),
  notInAlbum: photoGridKeys.notInAlbum(2, "videos"),
  timeline: photoGridKeys.withoutTimestamp(1, "all"),
};

function seededClient() {
  const client = new QueryClient();
  Object.values(keys).forEach(queryKey => client.setQueryData(queryKey, {}));
  return client;
}

const invalidated = (client: QueryClient) =>
  Object.entries(keys)
    .filter(([, queryKey]) => client.getQueryState(queryKey)?.isInvalidated)
    .map(([name]) => name);

describe("invalidateUserAlbumPhotos", () => {
  it("refreshes the album list, that album and every Not in an album page", () => {
    const client = seededClient();

    invalidateUserAlbumPhotos(client, "7");

    expect(invalidated(client)).toEqual(["albums", "album7", "notInAlbum"]);
  });

  it("refreshes no album grid without an album", () => {
    const client = seededClient();

    invalidateUserAlbumPhotos(client);

    expect(invalidated(client)).toEqual(["albums", "notInAlbum"]);
  });
});
