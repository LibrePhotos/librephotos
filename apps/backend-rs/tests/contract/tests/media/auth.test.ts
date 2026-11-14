/**
 * How media requests authenticate: the jwt cookie (what <img>/<video> send),
 * a stale cookie counting as anonymous, and a bad bearer header failing the
 * request. From test_unified_media_access_view.py (expired cookie cases) and
 * api/authentication.py.
 */
import { describe, expect, it } from "vitest";

import { login } from "../../src/client";
import { hasBase } from "../../src/env";
import { manifest, photo } from "../../src/manifest";
import { BASE_URL, REF_URL, raw, type RawRequest } from "./_media";

async function both(req: RawRequest) {
  const ref = await raw("anonymous", req, REF_URL);
  const actual = await raw("anonymous", req, BASE_URL);
  return { ref, actual };
}

describe.skipIf(!hasBase)("media authentication", () => {
  const priv = `/media/thumbnails_big/${photo("alice/e2e_01").image_hash}`;
  const pub = `/media/thumbnails_big/${photo("alice/e2e_05").image_hash}`;
  const inAlbum = `/media/photos/${photo("alice/berlin_01").image_hash}`;
  const share = `/api/public/photo/${manifest().shares.photo_share.slug}/media/thumbnail/`;

  const cases: [string, RawRequest][] = [
    ["garbage cookie, private photo", { path: priv, headers: { Cookie: "jwt=not-a-token" } }],
    ["garbage cookie, public photo", { path: pub, headers: { Cookie: "jwt=not-a-token" } }],
    ["garbage cookie, public album original", { path: inAlbum, headers: { Cookie: "jwt=not-a-token" } }],
    ["empty cookie, private photo", { path: priv, headers: { Cookie: "jwt=" } }],
    ["garbage bearer, private photo", { path: priv, headers: { Authorization: "Bearer not-a-token" } }],
    ["garbage bearer, public photo", { path: pub, headers: { Authorization: "Bearer not-a-token" } }],
    ["garbage bearer, photo share media", { path: share, headers: { Authorization: "Bearer not-a-token" } }],
    ["three-part authorization header", { path: pub, headers: { Authorization: "Bearer a b" } }],
    ["other scheme is ignored", { path: pub, headers: { Authorization: "Token abc" } }],
  ];

  it.each(cases)("%s", async (_name, req) => {
    const { ref, actual } = await both(req);
    expect(actual.status).toBe(ref.status);
    expect(actual.headers.get("x-media-error")).toBe(ref.headers.get("x-media-error"));
  });

  it("a valid jwt cookie authenticates, lowercase bearer too", async () => {
    for (const base of [REF_URL, BASE_URL]) {
      const { access, refresh } = await login("alice", base);
      const cookie = await raw("anonymous", { path: priv, headers: { Cookie: `jwt=${access}` } }, base);
      expect(cookie.status, base).toBe(200);
      const lower = await raw("anonymous", { path: priv, headers: { Authorization: `bearer ${access}` } }, base);
      expect(lower.status, base).toBe(200);
      // A refresh token in the cookie is not an access token: anonymous.
      const wrongType = await raw("anonymous", { path: priv, headers: { Cookie: `jwt=${refresh}` } }, base);
      expect(wrongType.status, base).toBe(403);
      expect(wrongType.headers.get("x-media-error"), base).toBe("authentication");
    }
  });

  it("a token from one server works on the other (shared SECRET_KEY)", async () => {
    const { access } = await login("alice", REF_URL);
    const res = await raw("anonymous", { path: priv, headers: { Authorization: `Bearer ${access}` } }, BASE_URL);
    expect(res.status).toBe(200);
  });
});
