/**
 * Direct mode only (both servers stream media themselves): the bytes, the
 * headers a browser acts on, HEAD, and single byte ranges must match the
 * reference. Seeded from api/tests/media_serving/test_media_direct_serving.py
 * and test_media_byte_ranges.py.
 */
import { describe, expect, it } from "vitest";

import { hasBase } from "../../src/env";
import { manifest, photo, type Role } from "../../src/manifest";
import { BASE_URL, DJANGO_500, MATRIX_PHOTOS, REF_URL, faceFiles, mediaHeaders, mediaMode, raw, type RawRequest } from "./_media";

const mode = hasBase ? await mediaMode(BASE_URL) : "x-accel";
const HEADERS = mediaHeaders("direct");

async function compare(role: Role, req: RawRequest) {
  const ref = await raw(role, req, REF_URL);
  const actual = await raw(role, req, BASE_URL);
  const problems: string[] = [];
  if (ref.status !== actual.status) problems.push(`status ${ref.status} != ${actual.status}`);
  for (const h of HEADERS) {
    if (ref.headers.get(h) !== actual.headers.get(h)) {
      problems.push(`${h}: ${ref.headers.get(h)} != ${actual.headers.get(h)}`);
    }
  }
  if (ref.sha !== actual.sha) problems.push(`body ${ref.bytes.length} bytes != ${actual.bytes.length} bytes`);
  return { ref, actual, problems };
}

function requests(): { name: string; req: RawRequest }[] {
  const out: { name: string; req: RawRequest }[] = [];
  for (const key of MATRIX_PHOTOS) {
    const p = photo(key);
    for (const kind of ["square_thumbnails_small", "square_thumbnails", "thumbnails_big"]) {
      out.push({ name: `${key} ${kind}`, req: { path: `/media/${kind}/${p.image_hash}` } });
    }
    out.push({ name: `${key} thumbnails_big by uuid`, req: { path: `/media/thumbnails_big/${p.id}` } });
    out.push({ name: `${key} photos`, req: { path: `/media/photos/${p.image_hash}` } });
    out.push({ name: `${key} photos .mp4`, req: { path: `/media/photos/${p.image_hash}.mp4` } });
  }
  for (const face of faceFiles()) out.push({ name: `face ${face}`, req: { path: `/media/faces/${face}` } });
  const slug = manifest().shares.photo_share.slug;
  out.push({ name: "photo share thumbnail", req: { path: `/api/public/photo/${slug}/media/thumbnail/` } });
  return out;
}

describe.skipIf(!hasBase || mode !== "direct")("media bytes (direct mode)", () => {
  const roles: Role[] = ["alice", "bob", "carol", "anonymous"];
  it.each(requests())("$name", async ({ name, req }) => {
    for (const role of roles) {
      const sane = DJANGO_500[name]?.[role];
      if (sane !== undefined) {
        expect((await raw(role, req, REF_URL)).status).toBe(500);
        expect((await raw(role, req, BASE_URL)).status).toBe(sane);
        continue;
      }
      const { problems } = await compare(role, req);
      expect(problems, role).toEqual([]);
    }
  });

  const video = photo("alice/video");
  const still = photo("alice/e2e_01");
  const ranged: [string, string, string][] = [
    ["closed range of a video", `/media/photos/${video.image_hash}.mp4`, "bytes=0-99"],
    ["open range of a video", `/media/photos/${video.image_hash}.mp4`, "bytes=100-"],
    ["suffix range (mp4 index lookup)", `/media/photos/${video.image_hash}.mp4`, "bytes=-500"],
    ["suffix longer than the file", `/media/square_thumbnails/${still.image_hash}`, "bytes=-99999999"],
    ["end past the file is clamped", `/media/thumbnails_big/${still.image_hash}`, "bytes=10-99999999"],
    ["start past the file is 416", `/media/thumbnails_big/${still.image_hash}`, "bytes=99999999-"],
    ["backwards range is 416", `/media/thumbnails_big/${still.image_hash}`, "bytes=50-10"],
    ["multi-range gets the whole file", `/media/thumbnails_big/${still.image_hash}`, "bytes=0-1,5-6"],
    ["unknown unit gets the whole file", `/media/thumbnails_big/${still.image_hash}`, "items=0-1"],
    ["range on the original", `/media/photos/${still.image_hash}`, "bytes=0-1023"],
    ["range on a video thumbnail", `/media/square_thumbnails/${video.image_hash}`, "bytes=0-10"],
  ];
  it.each(ranged)("%s", async (_name, path, range) => {
    const { actual, problems } = await compare("alice", { path, headers: { Range: range } });
    expect(problems).toEqual([]);
    expect([200, 206, 416]).toContain(actual.status);
  });

  it.each([
    ["thumbnail", `/media/thumbnails_big/${still.image_hash}`],
    ["original", `/media/photos/${still.image_hash}`],
    ["video", `/media/photos/${video.image_hash}.mp4`],
    ["private photo, anonymous", `/media/photos/${still.image_hash}`],
  ])("HEAD %s", async (_name, path) => {
    for (const role of ["alice", "anonymous"] as Role[]) {
      const { actual, problems } = await compare(role, { path, method: "HEAD" });
      expect(problems, role).toEqual([]);
      expect(actual.bytes.length).toBe(0);
    }
  });

  it("the jwt cookie authenticates like the header (what <img> sends)", async () => {
    const { actual, problems } = await compare("alice", {
      path: `/media/thumbnails_big/${still.image_hash}`,
      auth: "cookie",
    });
    expect(problems).toEqual([]);
    expect(actual.status).toBe(200);
  });
});
