// Read endpoints of the albums_tags area: contract (the frontend's own zod
// schemas), twin (Django reference on a clone of the same fixture) and authz.
//
// Arrays Django leaves unordered (M2M prefetches without ORDER BY) are
// compared as sets: shared_to, cover_photos, auto-album photos/people.
import {
  AutoAlbum,
  FetchAutoAlbumsListResponse,
  FetchPlaceAlbumResponse,
  FetchPlaceAlbumsListResponse,
  FetchThingAlbumResponse,
  FetchThingAlbumsListResponse,
  FetchUserAlbumsListResponse,
  TagAlbumResponse,
  UserAlbum,
} from "@librephotos/api-client";
import { UserAlbumListResponse } from "@fe/albums/types";
import { TagListResponse } from "@fe/tags/types";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { authzMatrix, authzProblems, type AuthzCase } from "../../src/authz";
import { call } from "../../src/client";
import { hasBase } from "../../src/env";
import { photosRoot, scanDirectory } from "../../src/live";
import { manifest, photo, type Role } from "../../src/manifest";
import { expectSchema } from "../../src/schema";
import { expectTwin } from "../../src/twin";

const USERS: Role[] = ["admin", "alice", "bob", "carol", "dave"];
const albums = () => manifest().albums;

// useFetchLocationClustersQuery.ts
const LocationClusters = z.array(z.array(z.union([z.number(), z.string()])));

// FolderNavigationResponse (useFetchFolderAlbumsQuery.ts) is a TS interface
// only; the fields the folder browser reads (03 §6).
const FolderNavigationResponse = z.object({
  current_path: z.string(),
  parent_path: z.string().nullable(),
  subfolders: z.array(
    z.object({ name: z.string(), path: z.string(), photo_count: z.number(), modified: z.number() }),
  ),
  pagination: z.object({
    page: z.number(),
    page_size: z.number(),
    total_folders: z.number(),
    total_pages: z.number(),
    has_next: z.boolean(),
    has_previous: z.boolean(),
  }),
});

// The auto-album list's shared schema plus what the page reads for covers.
const USER_LIST_UNORDERED = ["results[].shared_to"];

describe.skipIf(!hasBase)("user albums", () => {
  it("contract: /albums/user/list/ parses with both frontend schemas", async () => {
    const res = await call("alice", { path: "/api/albums/user/list/" });
    expect(res.status).toBe(200);
    const parsed = expectSchema(UserAlbumListResponse, res.body);
    expectSchema(FetchUserAlbumsListResponse, res.body);
    const own = Object.values(albums().user).filter(a => a.owner === "alice");
    expect(parsed.results.map(a => a.id).sort()).toEqual(own.map(a => a.id).sort());
  });

  it.each(USERS)("twin: /albums/user/list/ as %s", async role => {
    await expectTwin(role, { path: "/api/albums/user/list/" }, { project: ["*"], unordered: USER_LIST_UNORDERED });
  });

  it("twin: /albums/user/list/ search", async () => {
    await expectTwin("alice", { path: "/api/albums/user/list/", query: { search: "trip" } }, { project: ["*"] });
  });

  it.each(USERS)("twin: shared from/to me as %s", async role => {
    for (const path of ["/api/albums/user/shared/fromme/", "/api/albums/user/shared/tome/"]) {
      const res = await call(role, { path });
      expect(res.status).toBe(200);
      expectSchema(UserAlbumListResponse, res.body);
      await expectTwin(role, { path }, { project: ["*"], unordered: USER_LIST_UNORDERED });
    }
  });

  // Album-level `date` / `location` come from "the first photo" of an
  // unordered M2M in Django; Rust reads it in the same (heap) order.
  const detailSpec = { project: ["*"], unordered: ["shared_to", "grouped_photos[].items"] };

  it.each(Object.entries(manifest().albums.user))("twin + contract: detail of %s as its owner", async (_n, album) => {
    const path = `/api/albums/user/${album.id}/`;
    const res = await call(album.owner, { path });
    expect(res.status).toBe(200);
    expectSchema(UserAlbum, res.body);
    await expectTwin(album.owner, { path }, detailSpec);
    for (const query of [{ video: "true" }, { photo: "true" }, { is_screenshot: "true" }]) {
      await expectTwin(album.owner, { path, query }, detailSpec);
    }
  });

  it("twin: a recipient opens the album shared with them", async () => {
    const id = albums().user.shared_to_carol!.id;
    const res = await call("carol", { path: `/api/albums/user/${id}/` });
    expect(res.status).toBe(200);
    expectSchema(UserAlbum, res.body);
    await expectTwin("carol", { path: `/api/albums/user/${id}/` }, detailSpec);
  });

  it.each(["anonymous", "dave", "alice"] as const)("twin + contract: public album view as %s", async role => {
    const id = albums().user.public_trip!.id;
    for (const query of [{ public: "true" }, { public: "true", username: "alice" }, { public: "true", video: "true" }]) {
      const res = await call(role, { path: `/api/albums/user/${id}/`, query });
      expect(res.status).toBe(200);
      expectSchema(UserAlbum, res.body);
      await expectTwin(role, { path: `/api/albums/user/${id}/`, query }, detailSpec);
    }
  });

  it("twin: public view of an expired / private / other user's album is 404", async () => {
    const a = albums().user;
    for (const [id, query] of [
      [a.expired!.id, { public: "true" }],
      [a.vacation!.id, { public: "true" }],
      [a.public_trip!.id, { public: "true", username: "bob" }],
    ] as const) {
      await expectTwin("anonymous", { path: `/api/albums/user/${id}/`, query }, { project: ["*"] });
    }
  });

  it("twin: missing and malformed ids", async () => {
    for (const path of ["/api/albums/user/999999/", "/api/albums/user/abc/"]) {
      await expectTwin("alice", { path }, { project: ["*"] });
    }
  });
});

describe.skipIf(!hasBase)("auto albums", () => {
  // `photos` is an unordered prefetch in Django (its order follows the join
  // plan); Rust sends them oldest first. People follow the photos' heap order.
  const autoSpec = { project: ["*"], unordered: ["photos"] };

  it.each(USERS)("contract + twin: /albums/auto/list/ as %s", async role => {
    const res = await call(role, { path: "/api/albums/auto/list/" });
    expect(res.status).toBe(200);
    expectSchema(FetchAutoAlbumsListResponse, res.body);
    await expectTwin(role, { path: "/api/albums/auto/list/" }, { project: ["*"] });
  });

  it("twin: /albums/auto/list/ search", async () => {
    // The cover (`photos`) is one arbitrary non-hidden photo in Django (a
    // sliced prefetch without ORDER BY); compare everything else.
    await expectTwin(
      "alice",
      { path: "/api/albums/auto/list/", query: { search: "Anna" } },
      { project: ["count", "results[].id", "results[].title", "results[].timestamp", "results[].photo_count", "results[].favorited"] },
    );
  });

  it.each(manifest().albums.auto.map(a => [a.id, a.owner] as const))(
    "contract + twin: auto album %s",
    async (id, owner) => {
      const path = `/api/albums/auto/${id}/`;
      const res = await call(owner, { path });
      expect(res.status).toBe(200);
      expectSchema(AutoAlbum, res.body);
      await expectTwin(owner, { path }, autoSpec);
      // Someone else's album is a 404.
      await expectTwin(owner === "alice" ? "bob" : "alice", { path }, { project: ["*"] });
    },
  );
});

describe.skipIf(!hasBase)("thing and place albums", () => {
  it.each(USERS)("contract + twin: lists as %s", async role => {
    const things = await call(role, { path: "/api/albums/thing/list/" });
    expectSchema(FetchThingAlbumsListResponse, things.body);
    const places = await call(role, { path: "/api/albums/place/list/" });
    expectSchema(FetchPlaceAlbumsListResponse, places.body);
    await expectTwin(role, { path: "/api/albums/thing/list/" }, { project: ["*"] });
    await expectTwin(role, { path: "/api/albums/place/list/" }, { project: ["*"], unordered: ["results[].cover_photos"] });
  });

  const groupedSpec = { project: ["*"], unordered: ["results.grouped_photos[].items"] };

  it.each(manifest().albums.thing.map(a => [a.id, a.owner] as const))("contract + twin: thing album %s", async (id, owner) => {
    const path = `/api/albums/thing/${id}/`;
    const res = await call(owner, { path });
    expect(res.status).toBe(200);
    expectSchema(FetchThingAlbumResponse, res.body);
    await expectTwin(owner, { path }, groupedSpec);
    await expectTwin(owner, { path, query: { video: "true" } }, groupedSpec);
    await expectTwin(owner, { path, query: { photo: "true" } }, groupedSpec);
    // Not the requester's: {"results": {"title": ""}} with 200.
    await expectTwin(owner === "alice" ? "bob" : "alice", { path }, groupedSpec);
  });

  it.each(manifest().albums.place.map(a => [a.id, a.owner] as const))("contract + twin: place album %s", async (id, owner) => {
    const path = `/api/albums/place/${id}/`;
    const res = await call(owner, { path });
    expect(res.status).toBe(200);
    expectSchema(FetchPlaceAlbumResponse, res.body);
    await expectTwin(owner, { path }, groupedSpec);
    await expectTwin(owner, { path, query: { video: "true" } }, groupedSpec);
    await expectTwin("dave", { path }, groupedSpec);
  });

  it("twin: unknown ids", async () => {
    await expectTwin("alice", { path: "/api/albums/thing/999999/" }, { project: ["*"] });
    await expectTwin("alice", { path: "/api/albums/place/999999/" }, { project: ["*"] });
  });
});

describe.skipIf(!hasBase)("tags", () => {
  it.each(USERS)("contract + twin: /tags/ as %s", async role => {
    const res = await call(role, { path: "/api/tags/" });
    expect(res.status).toBe(200);
    expectSchema(TagListResponse, res.body);
    await expectTwin(role, { path: "/api/tags/" }, { project: ["*"], unordered: ["results[].cover_photos"] });
  });

  it("twin: /tags/?photo= by id and by hash", async () => {
    for (const key of ["alice/e2e_01", "alice/e2e_02", "alice/e2e_05", "alice/berlin_01", "bob/own_01"]) {
      const p = photo(key);
      for (const value of [p.id, p.image_hash, "not-a-photo"]) {
        await expectTwin("alice", { path: "/api/tags/", query: { photo: value } }, { project: ["*"], unordered: ["results[].cover_photos"] });
      }
    }
  });

  it.each(manifest().tags.map(t => [t.id, t.owner] as const))("contract + twin: tag %s detail", async (id, owner) => {
    const path = `/api/tags/${id}/`;
    const res = await call(owner, { path });
    expect(res.status).toBe(200);
    expectSchema(TagAlbumResponse, res.body);
    const spec = { project: ["*"], unordered: ["results.grouped_photos[].items"] };
    await expectTwin(owner, { path }, spec);
    await expectTwin(owner, { path, query: { video: "true" } }, spec);
    await expectTwin(owner === "alice" ? "bob" : "alice", { path }, { project: ["*"] });
  });
});

describe.skipIf(!hasBase)("location clusters and folders", () => {
  it.each(USERS)("contract + twin: /locclust/ as %s", async role => {
    const res = await call(role, { path: "/api/locclust/" });
    expect(res.status).toBe(200);
    expectSchema(LocationClusters, res.body);
    await expectTwin(role, { path: "/api/locclust/" }, { project: ["*"] });
  });

  it.each(USERS)("contract + twin: /folders/subfolders/ default path as %s", async role => {
    const res = await call(role, { path: "/api/folders/subfolders/" });
    if (res.status === 200) expectSchema(FolderNavigationResponse, res.body);
    await expectTwin(role, { path: "/api/folders/subfolders/" }, { project: ["*"] });
  });

  it("twin: subfolders of a sub-directory, a later page, and paths outside the scan directory", async () => {
    const aliceDir = await scanDirectory("alice");
    const cases: Record<string, string>[] = [
      { path: `${aliceDir}\\trips` },
      { path: aliceDir, page: "2" },
      { path: aliceDir, page: "x" },
      { path: await scanDirectory("bob") },
      { path: `${aliceDir}\\..\\bob` },
      { path: `${aliceDir}2` },
      { path: `${aliceDir}\\does-not-exist` },
      { path: `${aliceDir}\\e2e\\${"x"}` },
    ];
    for (const query of cases) {
      await expectTwin("alice", { path: "/api/folders/subfolders/", query }, { project: ["*"] });
    }
    // Admins browse DATA_ROOT.
    await expectTwin("admin", { path: "/api/folders/subfolders/", query: { path: await photosRoot() } }, { project: ["*"] });
  });
});

// Viewset reads the frontend does not use, and `page=last` / huge pages on
// the paginated lists.
describe.skipIf(!hasBase)("viewset reads and page edges", () => {
  const detailItems = { unordered: ["results[].shared_to", "results[].grouped_photos[].items"] };

  it.each([...USERS, "anonymous"] as Role[])("twin: /albums/user/ as %s", async role => {
    await expectTwin(role, { path: "/api/albums/user/" }, { project: ["*"], ...detailItems });
    await expectTwin(role, { path: "/api/albums/user/", query: { public: "true" } }, { project: ["*"], ...detailItems });
  });

  it("twin: /albums/user/ filters", async () => {
    for (const query of [{ video: "true" }, { photo: "true" }, { public: "true", username: "alice" }, { public: "true", username: "bob" }]) {
      await expectTwin("alice", { path: "/api/albums/user/", query }, { project: ["*"], ...detailItems });
    }
  });

  it.each(USERS)("twin: /albums/user/edit/ list and retrieve as %s", async role => {
    const spec = { project: ["*"], unordered: ["results[].photos", "photos"] };
    await expectTwin(role, { path: "/api/albums/user/edit/" }, spec);
    for (const album of Object.values(albums().user)) {
      await expectTwin(role, { path: `/api/albums/user/edit/${album.id}/` }, spec);
    }
    await expectTwin(role, { path: "/api/albums/user/edit/abc/" }, spec);
  });

  it("twin: page=last and pages past any end", async () => {
    const lists = [
      "/api/albums/user/list/",
      "/api/albums/user/shared/fromme/",
      "/api/albums/auto/list/",
      "/api/albums/thing/list/",
      "/api/albums/place/list/",
      "/api/tags/",
      "/api/albums/user/edit/",
    ];
    for (const path of lists) {
      for (const query of [{ page: "last", page_size: "2" }, { page: "99999999999999999" }, { page: "9223372036854775806" }]) {
        await expectTwin("alice", { path, query }, {
          project: ["count", "next", "previous", "results[].id", "errors"],
        });
      }
    }
  });
});

describe.skipIf(!hasBase)("authz: albums & tags reads", () => {
  const a = () => manifest().albums;
  const cases: AuthzCase[] = [
    { name: "user album list", req: { path: "/api/albums/user/list/" }, expect: { alice: 200, anonymous: 401 } },
    { name: "shared from me", req: { path: "/api/albums/user/shared/fromme/" }, expect: { alice: 200, anonymous: 401 } },
    { name: "shared to me", req: { path: "/api/albums/user/shared/tome/" }, expect: { carol: 200, anonymous: 401 } },
    {
      name: "album shared to carol",
      req: { path: `/api/albums/user/${a().user.shared_to_carol!.id}/` },
      expect: { alice: 200, carol: 200, bob: 404, dave: 404, anonymous: 401 },
    },
    {
      name: "private album",
      req: { path: `/api/albums/user/${a().user.vacation!.id}/` },
      expect: { alice: 200, carol: 404, anonymous: 401 },
    },
    {
      name: "public album via ?public",
      req: { path: `/api/albums/user/${a().user.public_trip!.id}/`, query: { public: "true" } },
      expect: { alice: 200, dave: 200, anonymous: 200 },
    },
    {
      name: "expired public album",
      req: { path: `/api/albums/user/${a().user.expired!.id}/`, query: { public: "true" } },
      expect: { alice: 404, anonymous: 404 },
    },
    { name: "auto list", req: { path: "/api/albums/auto/list/" }, expect: { alice: 200, anonymous: 401 } },
    {
      name: "alice's auto album",
      req: { path: `/api/albums/auto/${a().auto.find(x => x.owner === "alice")!.id}/` },
      expect: { alice: 200, bob: 404, anonymous: 401 },
    },
    { name: "thing list", req: { path: "/api/albums/thing/list/" }, expect: { alice: 200, anonymous: 401 } },
    {
      name: "alice's thing album",
      req: { path: `/api/albums/thing/${a().thing.find(x => x.owner === "alice")!.id}/` },
      expect: { alice: 200, bob: 200, anonymous: 401 },
    },
    { name: "place list", req: { path: "/api/albums/place/list/" }, expect: { alice: 200, anonymous: 401 } },
    {
      name: "alice's place album",
      req: { path: `/api/albums/place/${a().place[0]!.id}/` },
      expect: { alice: 200, dave: 200, anonymous: 401 },
    },
    { name: "tags", req: { path: "/api/tags/" }, expect: { alice: 200, anonymous: 401 } },
    {
      name: "alice's tag",
      req: { path: `/api/tags/${manifest().tags.find(t => t.owner === "alice")!.id}/` },
      expect: { alice: 200, bob: 404, anonymous: 401 },
    },
    { name: "location clusters", req: { path: "/api/locclust/" }, expect: { alice: 200, anonymous: 401 } },
    { name: "folders", req: { path: "/api/folders/subfolders/" }, expect: { alice: 200, anonymous: 401 } },
    {
      name: "folders: someone else's scan directory",
      // The path is filled in by beforeAll: bob's directory on the servers, not the manifest's.
      req: { path: "/api/folders/subfolders/", query: {} },
      expect: { alice: 403, bob: 200, admin: 200 },
    },
  ];

  beforeAll(async () => {
    const folders = cases.find(c => c.name === "folders: someone else's scan directory")!;
    folders.req.query = { path: await scanDirectory("bob") };
  });

  it.each(cases)("$name", async c => {
    const matrix = await authzMatrix([c]);
    expect(authzProblems(c, matrix[c.name]!)).toEqual([]);
  });
});
