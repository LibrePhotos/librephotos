import { describe, expect, it } from "vitest";

import { authzMatrix, authzProblems, type AuthzCase } from "../../src/authz";
import { hasBase } from "../../src/env";
import { manifest, photo } from "../../src/manifest";

const thumb = (key: string) => `/media/thumbnails_big/${photo(key).image_hash}`;

describe.skipIf(!hasBase)("authz: media", () => {
  const m = manifest();
  const cases: AuthzCase[] = [
    {
      name: "own photo",
      req: { path: thumb("alice/e2e_01") },
      headers: ["x-media-error"],
      expect: { alice: 200, bob: 404, dave: 404, anonymous: 403 },
    },
    {
      name: "photo shared directly to bob",
      req: { path: thumb("alice/e2e_06") },
      headers: ["x-media-error"],
      expect: { alice: 200, bob: 200, dave: 404, anonymous: 403 },
    },
    {
      name: "public photo",
      req: { path: thumb("alice/e2e_05") },
      headers: ["x-media-error"],
      expect: { dave: 200, anonymous: 200 },
    },
    {
      name: "album shared to carol vouches for the owner's photo",
      // e2e_06 is in the album and not public.
      req: { path: thumb("alice/e2e_06") },
      headers: ["x-media-error"],
      expect: { carol: 200, dave: 404 },
    },
    {
      // GHSA-phvg-g65q-rhq3: the album is alice's, the photo is bob's.
      name: "album shared to carol does not vouch for someone else's photo",
      req: { path: thumb(m.shares.album_shared_to_carol.foreign_photo) },
      headers: ["x-media-error"],
      expect: { bob: 200, carol: 404, alice: 404 },
    },
  ];

  it.each(cases)("$name", async c => {
    const matrix = await authzMatrix([c]);
    expect(authzProblems(c, matrix[c.name]!)).toEqual([]);
  });
});
