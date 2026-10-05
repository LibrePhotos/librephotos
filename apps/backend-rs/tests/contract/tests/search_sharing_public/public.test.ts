// Public pages: GET /api/public/albums/s/{slug}/ (routes/public/s.$slug.tsx),
// /api/public/albums/s/{slug}/photos/{photo}/ (useFetchPublicPhotoDetailQuery)
// and /api/public/photo/{slug}/ (useFetchSharedPhotoQuery, a raw fetch).
import { UserAlbum } from "@librephotos/api-client";
import { describe, expect, it } from "vitest";

import { authzMatrix, authzProblems, type AuthzCase } from "../../src/authz";
import { call } from "../../src/client";
import { hasBase } from "../../src/env";
import { manifest, type ManifestPhoto, photo, type Role } from "../../src/manifest";
import { expectSchema } from "../../src/schema";
import { PublicPhotoDetailResponse, SharedPhotoResponse } from "../../src/schemas/search_sharing_public";
import { expectTwin } from "../../src/twin";

const ALL: Role[] = ["admin", "alice", "bob", "carol", "dave", "anonymous"];
const shares = () => manifest().shares;
const albumPath = () => `/api/public/albums/s/${shares().public_album.slug}/`;
const WHOLE = { project: ["*"], unordered: ["results.grouped_photos[].items"] };

describe.skipIf(!hasBase)("GET /api/public/albums/s/{slug}/", () => {
  it("contract: the public album parses as UserAlbum and hides what the owner does not share", async () => {
    const res = await call<{ results: unknown; sharing_settings: Record<string, boolean> }>("anonymous", {
      path: albumPath(),
    });
    expect(res.status).toBe(200);
    const album = expectSchema(UserAlbum, res.body.results);
    const trip = manifest().albums.user.public_trip!;
    expect(album.id).toBe(String(trip.id));
    const ids = album.grouped_photos.flatMap(g => g.items.map(i => i.id));
    expect(ids.sort()).toEqual([...trip.photos].sort());
    // The fixture shares nothing beyond the photos: no dates, no places.
    expect(res.body.sharing_settings.share_timestamps).toBe(false);
    for (const g of album.grouped_photos) {
      expect(g.date).toBeNull();
      for (const i of g.items) {
        expect(i.date).toBe("");
        expect(i.exif_gps_lat).toBeNull();
        expect(i.location).toBe("");
      }
    }
  });

  it.each(ALL)("twin (%s): whole body", async role => {
    await expectTwin(role, { path: albumPath() }, WHOLE);
  });

  it.each([
    ["videos only", { video: "true" }],
    ["photos only", { photo: "true" }],
  ] as const)("twin: %s", async (_name, query) => {
    await expectTwin("anonymous", { path: albumPath(), query }, WHOLE);
  });

  it("twin: an expired share is a 404", async () => {
    const { actual } = await expectTwin("anonymous", { path: `/api/public/albums/s/${shares().expired_album.slug}/` }, {
      project: ["*"],
    });
    expect(actual.status).toBe(404);
  });

  it("twin: an unknown slug is a 404 (the slug-availability check reads any error as free)", async () => {
    const { actual } = await expectTwin("alice", { path: "/api/public/albums/s/no-such-slug-here/" }, { project: ["*"] });
    expect(actual.status).toBe(404);
  });

  it("twin: a bad Authorization header is a 401 even here", async () => {
    await expectTwin(
      "anonymous",
      { path: albumPath(), headers: { Authorization: "Bearer not-a-token" } },
      { project: ["__status_only__"] },
    );
  });
});

describe.skipIf(!hasBase)("GET /api/public/albums/s/{slug}/photos/{photo}/", () => {
  const inAlbum = (): ManifestPhoto => {
    const id = manifest().albums.user.public_trip!.photos[0]!;
    return Object.values(manifest().photos).find(p => p.id === id)!;
  };

  it("contract: a photo of the album parses, by hash and by UUID", async () => {
    for (const ref of [inAlbum().image_hash, inAlbum().id]) {
      const res = await call("anonymous", { path: `${albumPath()}photos/${ref}/` });
      expect(res.status).toBe(200);
      const parsed = expectSchema(PublicPhotoDetailResponse, res.body);
      expect(parsed.results.image_hash).toBe(inAlbum().image_hash);
      expect(parsed.results.people).toEqual([]);
    }
  });

  const refs: [string, () => string][] = [
    ["by image hash", () => inAlbum().image_hash],
    ["by uuid", () => inAlbum().id],
    ["a photo outside the album", () => photo("alice/e2e_01").image_hash],
    ["an unknown id", () => "nothere"],
  ];
  it.each(refs)("twin (anonymous): %s", async (_name, ref) => {
    await expectTwin("anonymous", { path: `${albumPath()}photos/${ref()}/` }, { project: ["*"] });
  });

  it("a malformed UUID-shaped id is a 404 (Django answers 500: its pk lookup raises)", async () => {
    const res = await call("anonymous", { path: `${albumPath()}photos/zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz/` });
    expect(res.status).toBe(404);
  });

  it("twin: expired share", async () => {
    await expectTwin(
      "anonymous",
      { path: `/api/public/albums/s/${shares().expired_album.slug}/photos/${inAlbum().image_hash}/` },
      { project: ["*"] },
    );
  });

  it.each(ALL)("twin (%s)", async role => {
    await expectTwin(role, { path: `${albumPath()}photos/${inAlbum().image_hash}/` }, { project: ["*"] });
  });
});

describe.skipIf(!hasBase)("GET /api/public/photo/{slug}/", () => {
  const path = () => `/api/public/photo/${shares().photo_share.slug}/`;

  it("contract: the shared photo parses and carries no hash-derived field", async () => {
    const res = await call<{ results: Record<string, unknown> }>("anonymous", { path: path() });
    expect(res.status).toBe(200);
    const parsed = expectSchema(SharedPhotoResponse, res.body);
    expect(parsed.results.thumbnail_url).toBe(`/api/public/photo/${shares().photo_share.slug}/media/thumbnail/`);
    for (const k of ["image_hash", "square_thumbnail_url", "big_thumbnail_url", "small_square_thumbnail_url"]) {
      expect(res.body.results).not.toHaveProperty(k);
    }
  });

  it.each(ALL)("twin (%s): whole body", async role => {
    await expectTwin(role, { path: path() }, { project: ["*"] });
  });

  it("twin: unknown slug is a 404 (revoked link)", async () => {
    const { actual } = await expectTwin("anonymous", { path: "/api/public/photo/not-a-share/" }, { project: ["*"] });
    expect(actual.status).toBe(404);
  });
});

describe.skipIf(!hasBase)("authz: public pages", () => {
  const cases = (): AuthzCase[] => [
    {
      name: "public album",
      req: { path: albumPath() },
      expect: { anonymous: 200, dave: 200, alice: 200 },
    },
    {
      name: "expired public album",
      req: { path: `/api/public/albums/s/${shares().expired_album.slug}/` },
      expect: { anonymous: 404, alice: 404 },
    },
    {
      name: "public album photo",
      req: { path: `${albumPath()}photos/${manifest().albums.user.public_trip!.photos[0]}/` },
      expect: { anonymous: 200 },
    },
    {
      name: "photo share",
      req: { path: `/api/public/photo/${shares().photo_share.slug}/` },
      expect: { anonymous: 200, bob: 200 },
    },
  ];
  it("matrix", async () => {
    const cs = cases();
    const matrix = await authzMatrix(cs);
    expect(cs.flatMap(c => authzProblems(c, matrix[c.name]!))).toEqual([]);
  });
});
