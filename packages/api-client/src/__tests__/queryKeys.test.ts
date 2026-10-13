import { hashKey, QueryClient, type QueryKey } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { albumKeys, faceKeys, photoGridKeys, userKeys } from "../hooks";
import { Photoset } from "../schemas";

// The web and mobile apps build their keys with these factories. A `...Raw` entry holds an answer
// as the server sends it, next to the web's reshaped one: never the same key, always the same family.
const rawEntries: [string, QueryKey, QueryKey, QueryKey][] = [
  [
    "photoGridKeys.dateAlbumListRaw",
    photoGridKeys.dateAlbumListRaw(Photoset.TIMESTAMP),
    photoGridKeys.dateAlbumList([Photoset.TIMESTAMP, undefined, undefined, undefined, "all", "none"]),
    photoGridKeys.kind("dateAlbums"),
  ],
  ["photoGridKeys.sharedByMeRaw", photoGridKeys.sharedByMeRaw(), photoGridKeys.sharedByMe(), photoGridKeys.all],
  ["photoGridKeys.sharedWithMeRaw", photoGridKeys.sharedWithMeRaw(), photoGridKeys.sharedWithMe(), photoGridKeys.all],
  ["albumKeys.peopleAlbumsRaw", albumKeys.peopleAlbumsRaw(), albumKeys.peopleAlbums(), albumKeys.all],
  ["albumKeys.sharedByMeRaw", albumKeys.sharedByMeRaw(), albumKeys.sharedByMe(), albumKeys.all],
  ["albumKeys.sharedWithMeRaw", albumKeys.sharedWithMeRaw(), albumKeys.sharedWithMe(), albumKeys.all],
  [
    "faceKeys.personFacePageRaw",
    faceKeys.personFacePageRaw({ person: 0, inferred: false, page: 1 }),
    faceKeys.personFacePage({ person: 0, inferred: false, page: 1, orderBy: "confidence" }),
    faceKeys.personFaces(),
  ],
  [
    "faceKeys.incompleteListRaw",
    faceKeys.incompleteListRaw(false),
    faceKeys.incompleteList({ inferred: false, orderBy: "confidence" }),
    faceKeys.incomplete(),
  ],
];

describe("query key factories", () => {
  it.each(rawEntries)("%s is keyed apart from the web's entry, in the same family", (_name, raw, web, family) => {
    expect(hashKey(raw)).not.toBe(hashKey(web));
    const client = new QueryClient();
    client.setQueryData(raw, 0);
    client.setQueryData(web, 0);
    expect(client.getQueryCache().findAll({ queryKey: family })).toHaveLength(2);
  });

  it("keys a user's details by the id as a string, number or not", () => {
    expect(userKeys.selfDetail(3)).toEqual(userKeys.selfDetail("3"));
  });

  it("puts every photo grid under photoGridKeys.all", () => {
    const client = new QueryClient();
    const grids = [
      photoGridKeys.dateAlbumDay([Photoset.NONE, undefined, undefined, undefined, "all", "none"], 1, 1),
      photoGridKeys.recentlyAdded(),
      photoGridKeys.thingsAlbum("1", "all"),
      photoGridKeys.search("tram", "all", "grouped"),
      photoGridKeys.sharedByMeRaw(),
    ];
    grids.forEach(queryKey => client.setQueryData(queryKey, 0));
    client.setQueryData(albumKeys.userAlbums(), 0);
    expect(client.getQueryCache().findAll({ queryKey: photoGridKeys.all })).toHaveLength(grids.length);
  });
});
