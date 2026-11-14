/**
 * Media behaviour with no Django twin:
 * - GET /api/downloads/{uuid}{userId}: nginx-only on Django (404 without
 *   it); Rust serves it itself, authenticated, to the archive's owner only.
 * - Path traversal: Django joins raw URL text into X-Accel-Redirect targets
 *   and file paths; Rust confines every path and answers 404 instead.
 */
import { describe, expect, it } from "vitest";

import { hasBase } from "../../src/env";
import { photo, user } from "../../src/manifest";
import { BASE_URL, ZIP_UUID, mediaMode, raw } from "./_media";

const mode = hasBase ? await mediaMode(BASE_URL) : "x-accel";

describe.skipIf(!hasBase)("GET /api/downloads/{uuid}{userId} (Rust only)", () => {
  const alice = user("alice");
  const bob = user("bob");

  it("anonymous is not authenticated", async () => {
    const res = await raw("anonymous", { path: `/api/downloads/${ZIP_UUID}${alice.id}` }, BASE_URL);
    expect(res.status).toBe(401);
  });

  it("another user's archive is not found", async () => {
    const res = await raw("alice", { path: `/api/downloads/${ZIP_UUID}${bob.id}` }, BASE_URL);
    expect(res.status).toBe(404);
  });

  it.each(["job-1", `${ZIP_UUID}`, `..${alice.id}`, `${ZIP_UUID}${alice.id}0`])("malformed name %s is 404", async name => {
    const res = await raw("alice", { path: `/api/downloads/${name}` }, BASE_URL);
    expect(res.status).toBe(404);
  });

  it("the owner's archive: handed to nginx, or 404 when not on disk", async () => {
    const res = await raw("alice", { path: `/api/downloads/${ZIP_UUID}${alice.id}` }, BASE_URL);
    if (mode === "x-accel") {
      expect(res.status).toBe(200);
      expect(res.headers.get("x-accel-redirect")).toBe(`/protected_media/zip/${ZIP_UUID}${alice.id}.zip`);
      expect(res.headers.get("content-type")).toBe("application/x-zip-compressed");
    } else {
      expect(res.status).toBe(404);
    }
  });
});

describe.skipIf(!hasBase)("path confinement (Rust only)", () => {
  const h = photo("alice/e2e_01").image_hash;
  const face = `${h}_0.jpg`;
  it.each([
    ["dot-dot in the path", `/media/faces%2F..%2F..%2Fdata%2Falice%2Fe2e/${face}`],
    ["dot-dot as the path", `/media/..%2F..%2Ffaces/${face}`],
    ["backslash traversal", `/media/faces%5C..%5C..%5Cdata/${face}`],
    ["dot-dot in a thumbnail path", `/media/thumbnails_big%2F..%2F..%2Fdata%2Falice%2Fe2e/${h}_x.jpg`],
    ["zip dot-dot", "/media/zip/..%5Csecret"],
    ["avatar dot-dot", "/media/avatars/..%2F..%2Fdata%2Falice%2Fe2e%2Fe2e_01.jpg"],
  ])("%s is never served", async (_name, path) => {
    const res = await raw("alice", { path }, BASE_URL);
    expect(res.status).not.toBe(200);
    expect(res.headers.get("x-accel-redirect")).toBeNull();
  });
});
