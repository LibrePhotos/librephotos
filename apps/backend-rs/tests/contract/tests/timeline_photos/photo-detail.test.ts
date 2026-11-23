// GET /photos/{hash|uuid}/ (unvalidated by the frontend: 03 §6 lists the
// fields read; the shared Photo schema covers them) and GET /photos/{h}/albums/.
import { Photo } from "@librephotos/api-client";
import { describe, expect, it } from "vitest";

import { authzMatrix, authzProblems, type AuthzCase } from "../../src/authz";
import { call } from "../../src/client";
import { hasBase } from "../../src/env";
import { category, manifest, photo, type Role } from "../../src/manifest";
import { expectSchema } from "../../src/schema";
import { PhotoAlbumsResponse } from "../../src/schemas/timeline_photos";
import { expectTwin } from "../../src/twin";

// Everything the lightbox reads (03 §6) plus the flags; exif_json is dropped.
const DETAIL = [
  "id",
  "image_hash",
  "image_path",
  "video",
  "embedded_media",
  "rating",
  "hidden",
  "public",
  "removed",
  "in_trashcan",
  "exif_timestamp",
  "exif_gps_lat",
  "exif_gps_lon",
  "search_location",
  "search_captions",
  "camera",
  "lens",
  "fstop",
  "iso",
  "focal_length",
  "shutter_speed",
  "subjectDistance",
  "focalLength35Equivalent",
  "digitalZoomRatio",
  "width",
  "height",
  "size",
  "captions_json",
  "geolocation_json",
  "people",
  "similar_photos",
  "file_variants",
  "stacks",
  "ocr",
  "metadata",
  "owner",
  "shared_to",
  "big_thumbnail_url",
  "square_thumbnail_url",
  "small_square_thumbnail_url",
  "local_orientation",
];
const ALBUMS = [
  "results[].id",
  "results[].title",
  "results[].cover_photo",
  "results[].photo_count",
  "results[].owner",
  "results[].shared_to",
  "results[].created_on",
  "results[].favorited",
  "results[].public",
  "results[].public_slug",
  "results[].public_expires_at",
  "results[].public_sharing_options",
];
const ROLES: Role[] = ["admin", "alice", "bob", "carol", "dave", "anonymous"];

describe.skipIf(!hasBase)("timeline_photos: GET /api/photos/{id}/", () => {
  it("contract: every photo its owner can open parses", async () => {
    for (const [key, p] of Object.entries(manifest().photos)) {
      const res = await call(p.owner, { path: `/api/photos/${p.image_hash}/` });
      if (p.hidden || p.in_trashcan || p.removed || p.aspect_ratio === null) {
        expect(res.status, key).toBe(404);
        continue;
      }
      expect(res.status, key).toBe(200);
      const d = expectSchema(Photo, res.body, key);
      expect(d.id).toBe(p.id);
      expect((res.body as Record<string, unknown>).exif_json).toBeUndefined();
    }
  });

  it("contract: OCR blocks for the owner only, stacks, variants", async () => {
    const ocr = category("ocr")[0]!;
    const own = (await call(ocr.owner, { path: `/api/photos/${ocr.id}/` })).body as { ocr: { blocks: unknown[] } | null };
    expect(own.ocr?.blocks.length).toBeGreaterThan(0);
    const burst = Object.values(manifest().photos).find(x => x.id === manifest().stacks.burst.primary)!;
    const stacked = expectSchema(Photo, (await call(burst.owner, { path: `/api/photos/${burst.image_hash}/` })).body);
    expect(stacked.stacks?.[0]?.type).toBe("burst");
    const raw = category("raw_variant")[0]!;
    const variants = expectSchema(Photo, (await call(raw.owner, { path: `/api/photos/${raw.image_hash}/` })).body);
    expect(variants.file_variants?.length).toBeGreaterThan(1);
  });

  it("twin: every photo by hash, as every role", async () => {
    for (const p of Object.values(manifest().photos)) {
      for (const role of ROLES) {
        await expectTwin(role, { path: `/api/photos/${p.image_hash}/` }, { project: DETAIL, refStable: false });
      }
    }
  });

  it("twin: by uuid, and unknown keys", async () => {
    for (const p of Object.values(manifest().photos)) {
      await expectTwin(p.owner, { path: `/api/photos/${p.id}/` }, { project: DETAIL, refStable: false });
    }
    for (const key of ["deadbeef", "00000000-0000-0000-0000-000000000000", "NOT-A-HASH"]) {
      await expectTwin("alice", { path: `/api/photos/${key}/` }, { project: [] });
    }
  });
});

describe.skipIf(!hasBase)("timeline_photos: GET /api/photos/{id}/albums/", () => {
  it("contract: alice's album photos parse", async () => {
    const vacation = manifest().albums.user.vacation!;
    const p = Object.values(manifest().photos).find(x => x.id === vacation.photos[0])!;
    const res = await call("alice", { path: `/api/photos/${p.image_hash}/albums/` });
    expect(res.status).toBe(200);
    const { results } = expectSchema(PhotoAlbumsResponse, res.body);
    expect(results.map(a => a.id)).toContain(vacation.id);
  });

  it("twin: every photo, as every role", async () => {
    for (const p of Object.values(manifest().photos)) {
      for (const role of ROLES) {
        await expectTwin(role, { path: `/api/photos/${p.image_hash}/albums/` }, { project: ALBUMS, refStable: false });
      }
    }
  });
});

describe.skipIf(!hasBase)("timeline_photos: authz photo detail + albums", () => {
  const key = (name: string) => category(name)[0]!;
  const ghsa = photo(manifest().shares.album_shared_to_carol.foreign_photo);
  const cases: AuthzCase[] = [
    { name: "own private photo", req: { path: `/api/photos/${photo("alice/e2e_01").image_hash}/` }, expect: { alice: 200, dave: 404, anonymous: 404 } },
    { name: "shared to bob", req: { path: `/api/photos/${key("shared_to_bob").image_hash}/` }, expect: { bob: 200, carol: 404 } },
    { name: "public photo", req: { path: `/api/photos/${key("public").image_hash}/` }, expect: { anonymous: 200 } },
    { name: "hidden photo", req: { path: `/api/photos/${key("hidden").image_hash}/` } },
    { name: "trashed photo", req: { path: `/api/photos/${key("trashed").image_hash}/` } },
    { name: "foreign photo in carol's album", req: { path: `/api/photos/${ghsa.image_hash}/` } },
    { name: "albums: own photo", req: { path: `/api/photos/${photo("alice/e2e_01").image_hash}/albums/` } },
    { name: "albums: foreign photo in carol's album", req: { path: `/api/photos/${ghsa.image_hash}/albums/` } },
    { name: "albums: public photo", req: { path: `/api/photos/${key("public").image_hash}/albums/` }, expect: { anonymous: 200 } },
  ];
  it.each(cases)("$name", async c => {
    const matrix = await authzMatrix([c]);
    expect(authzProblems(c, matrix[c.name]!)).toEqual([]);
  });
});
