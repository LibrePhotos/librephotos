/**
 * "Always transcode videos" (api/tests/media_serving/test_transcode_cache.py,
 * test_issue_477_video_transcode_on_photos_path.py). Needs its own setup, so
 * it only runs with LP_TRANSCODE_TWIN=1: each server on its own clone with
 * its own media copy (the cache lives in protected_media/transcoded) and
 * alice's transcode_videos switched on:
 *
 *   F=apps/backend-rs/tests/fixture; R=C:/Users/Niaz/librephotos/rust-pg/fixture-runs
 *   $F/clone_db.sh lp_mut_rsmedia_tc_ref $R/rsmedia-tc-ref
 *   $F/clone_db.sh lp_mut_rsmedia_tc_rs  $R/rsmedia-tc-rs
 *   psql -d <each> -c "UPDATE api_user SET transcode_videos = TRUE WHERE username = 'alice'"
 *   LP_MEDIA_ROOT=$R/rsmedia-tc-ref $F/run_django.sh lp_mut_rsmedia_tc_ref 8102 direct &
 *   (Rust on lp_mut_rsmedia_tc_rs, BASE_DATA=$R/rsmedia-tc-rs, LP_MEDIA_MODE=direct, port 8103)
 *   (add LP_TC_SEED_REF=1 when Django runs under Git Bash on Windows, see below)
 *   LP_TRANSCODE_TWIN=1 LP_TC_REF_MEDIA=$R/rsmedia-tc-ref LP_TC_RS_MEDIA=$R/rsmedia-tc-rs npx vitest run tests/media/transcode.test.ts
 */
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { hasBase } from "../../src/env";
import { photo, type Role } from "../../src/manifest";
import { BASE_URL, REF_URL, raw } from "./_media";

const enabled = hasBase && process.env.LP_TRANSCODE_TWIN === "1";

/** Wait for `<media dir>/protected_media/transcoded/<hash>.mp4` (LP_TC_REF_MEDIA / LP_TC_RS_MEDIA). */
async function waitForCache(mediaDir: string | undefined, hash: string): Promise<void> {
  if (!mediaDir) throw new Error("set LP_TC_REF_MEDIA and LP_TC_RS_MEDIA to the two media copies");
  const file = join(mediaDir, "protected_media", "transcoded", `${hash}.mp4`);
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (existsSync(file)) return;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`${file} was never written`);
}

describe.skipIf(!enabled)("transcoded video playback", () => {
  const v = photo("alice/video");
  const paths = [`/media/photos/${v.image_hash}.mp4`, `/media/photos/${v.image_hash}`, `/media/video/${v.image_hash}`];
  const headers = ["content-type", "cache-control", "accept-ranges", "x-media-error"];

  it("first play streams a live conversion, then the seekable copy is served", { timeout: 300_000 }, async () => {
    const first = paths[0]!;
    const ref = await raw("alice", { path: first }, REF_URL);
    const actual = await raw("alice", { path: first }, BASE_URL);
    for (const h of headers) expect(actual.headers.get(h), h).toBe(ref.headers.get(h));
    expect(actual.status).toBe(ref.status);
    expect(actual.headers.get("cache-control")).toBe("no-store");
    expect(actual.bytes.subarray(4, 8).toString("latin1")).toBe("ftyp");

    await waitForCache(process.env.LP_TC_RS_MEDIA, v.image_hash);
    if (process.env.LP_TC_SEED_REF === "1") {
      // Django under Git Bash on Windows finds MSYS `nice`, which re-parses
      // argv and drops the quotes in scale=-2:'min(720,ih)', so its cached
      // conversion always exits 8 there (not on Linux). Seed its cache with
      // the same conversion so the cached-playback half stays comparable.
      const cached = (dir: string) => join(dir, "protected_media", "transcoded", `${v.image_hash}.mp4`);
      const refFile = cached(process.env.LP_TC_REF_MEDIA!);
      if (!existsSync(refFile)) copyFileSync(cached(process.env.LP_TC_RS_MEDIA!), refFile);
    }
    await waitForCache(process.env.LP_TC_REF_MEDIA, v.image_hash);
    for (const path of paths) {
      const r = await raw("alice", { path }, REF_URL);
      const a = await raw("alice", { path }, BASE_URL);
      expect(a.status, path).toBe(r.status);
      for (const h of headers) expect(a.headers.get(h), `${path} ${h}`).toBe(r.headers.get(h));
      const rr = await raw("alice", { path, headers: { Range: "bytes=0-99" } }, REF_URL);
      const ar = await raw("alice", { path, headers: { Range: "bytes=0-99" } }, BASE_URL);
      expect(ar.status, path).toBe(rr.status);
    }
  });

  it("thumbnails and other viewers are never transcoded", async () => {
    const cases: [Role, string][] = [
      ["alice", `/media/square_thumbnails/${v.image_hash}`],
      ["bob", `/media/photos/${v.image_hash}.mp4`],
      ["anonymous", `/media/photos/${v.image_hash}.mp4`],
    ];
    for (const [role, path] of cases) {
      const r = await raw(role, { path }, REF_URL);
      const a = await raw(role, { path }, BASE_URL);
      expect(a.status, `${role} ${path}`).toBe(r.status);
      for (const h of headers) expect(a.headers.get(h), `${role} ${path} ${h}`).toBe(r.headers.get(h));
      if (r.status === 200) expect(a.sha).toBe(r.sha);
    }
  });
});
