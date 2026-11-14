/**
 * Shared pieces of the media cases (`/media/*`, `/api/public/photo/{slug}/media/*`,
 * `/api/downloads/*`, `/api/media/diagnostics/*`): raw byte-level requests,
 * the delivery mode each server runs in, and the case list seeded from
 * apps/backend/api/tests/media_serving/ and sharing_and_public/.
 */
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import type { AuthzCase } from "../../src/authz";
import { login } from "../../src/client";
import { BASE_URL, REF_URL } from "../../src/env";
import { manifest, photo, type Role } from "../../src/manifest";

export interface RawResponse {
  status: number;
  headers: Headers;
  bytes: Buffer;
  sha: string;
}

export interface RawRequest {
  path: string;
  method?: "GET" | "HEAD";
  headers?: Record<string, string>;
  /** How a signed-in role authenticates: bearer header (default) or the jwt cookie <img> tags use. */
  auth?: "header" | "cookie";
}

/** A request whose body is kept as bytes (media is binary). */
export async function raw(role: Role, req: RawRequest, baseUrl: string): Promise<RawResponse> {
  const headers: Record<string, string> = { ...req.headers };
  if (role !== "anonymous") {
    const { access } = await login(role, baseUrl);
    if (req.auth === "cookie") headers.Cookie = `jwt=${access}`;
    else headers.Authorization = `Bearer ${access}`;
  }
  const res = await fetch(baseUrl + req.path, { method: req.method ?? "GET", headers, redirect: "manual" });
  const bytes = Buffer.from(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, bytes, sha: createHash("sha256").update(bytes).digest("hex") };
}

export type MediaMode = "x-accel" | "direct";

/** Which delivery mode a server runs in, from how it answers the owner's thumbnail. */
export async function mediaMode(baseUrl: string): Promise<MediaMode> {
  const res = await raw("alice", { path: `/media/thumbnails_big/${photo("alice/e2e_01").image_hash}` }, baseUrl);
  if (res.status !== 200) throw new Error(`${baseUrl}: owner thumbnail answered ${res.status}`);
  return res.headers.get("x-accel-redirect") ? "x-accel" : "direct";
}

/** Headers compared per mode (what nginx or the browser acts on). */
export function mediaHeaders(mode: MediaMode): string[] {
  return mode === "x-accel"
    ? ["content-type", "x-accel-redirect", "x-media-error", "content-disposition", "cache-control"]
    : [
        "content-type",
        "x-media-error",
        "content-disposition",
        "content-length",
        "accept-ranges",
        "content-range",
        "cache-control",
      ];
}

/** Face crop file names on disk (`faces/<image_hash>_<n>.jpg`). */
export function faceFiles(): string[] {
  const m = manifest();
  return readdirSync(join(m.media_root, "faces")).sort();
}

export const ZIP_UUID = "0f8fad5b-d9cb-469f-a165-70867728950e";

/** Photos the media matrix walks: every access situation the fixture has. */
export const MATRIX_PHOTOS = [
  "alice/e2e_01", // private, owner only; same file as bob/e2e_01
  "alice/e2e_05", // public
  "alice/e2e_06", // shared to bob, in the album shared to carol
  "alice/e2e_07", // shared to bob
  "alice/e2e_08", // photo share slug
  "alice/berlin_01", // public, in the public album
  "alice/tokyo_01",
  "alice/hidden",
  "alice/trashed",
  "alice/removed",
  "alice/no_thumbnail",
  "alice/no_timestamp",
  "alice/video",
  "alice/heic",
  "alice/png",
  "alice/unicode",
  "alice/specialchars",
  "alice/raw_pair",
  "alice/burst_1",
  "bob/e2e_01",
  "bob/own_01",
  "bob/own_02", // GHSA-phvg: bob's photo inside alice's album shared to carol
  "carol/own_01",
  "dave/own_01",
  "admin/own_01",
];

/** Derived and original kinds, addressed the way the frontend addresses them. */
function photoRequests(key: string): { name: string; path: string }[] {
  const p = photo(key);
  const h = p.image_hash;
  return [
    { name: `${key} square_thumbnails_small`, path: `/media/square_thumbnails_small/${h}` },
    { name: `${key} square_thumbnails`, path: `/media/square_thumbnails/${h}` },
    { name: `${key} thumbnails_big`, path: `/media/thumbnails_big/${h}` },
    { name: `${key} thumbnails_big ?v=2`, path: `/media/thumbnails_big/${h}?v=2` },
    { name: `${key} thumbnails_big by uuid`, path: `/media/thumbnails_big/${p.id}` },
    { name: `${key} square_thumbnails by uuid`, path: `/media/square_thumbnails/${p.id}` },
    { name: `${key} photos`, path: `/media/photos/${h}` },
    { name: `${key} photos .jpg`, path: `/media/photos/${h}.jpg` },
    { name: `${key} photos .mp4`, path: `/media/photos/${h}.mp4` },
    { name: `${key} photos by uuid (never accepted)`, path: `/media/photos/${p.id}` },
    { name: `${key} embedded_media`, path: `/media/embedded_media/${h}` },
    { name: `${key} legacy video path`, path: `/media/video/${h}` },
  ];
}

/** The media authz cases (status + mode headers per role, reference vs actual). */
export function mediaCases(mode: MediaMode): AuthzCase[] {
  const headers = mediaHeaders(mode);
  const cases: AuthzCase[] = [];
  for (const key of MATRIX_PHOTOS) {
    for (const r of photoRequests(key)) cases.push({ name: r.name, req: { path: r.path }, headers });
  }
  for (const face of faceFiles()) {
    cases.push({ name: `face ${face}`, req: { path: `/media/faces/${face}` }, headers });
  }
  const m = manifest();
  const extra: [string, string][] = [
    ["unknown hash", "/media/thumbnails_big/0123456789abcdef0123456789abcdef9"],
    ["unknown uuid", "/media/thumbnails_big/00000000-0000-4000-8000-000000000000"],
    ["malformed uuid", "/media/thumbnails_big/zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz"],
    ["unknown original", "/media/photos/0123456789abcdef0123456789abcdef9"],
    ["kind is case-insensitive (Photos)", `/media/Photos/${photo("alice/e2e_01").image_hash}`],
    ["thumbnail with extension", `/media/thumbnails_big/${photo("alice/e2e_01").image_hash}.webp`],
    ["suffix after underscore", `/media/square_thumbnails/${photo("alice/e2e_01").image_hash}_whatever.webp`],
    ["zip by uuid", `/media/zip/${ZIP_UUID}`],
    ["zip by uppercase uuid", `/media/zip/${ZIP_UUID.toUpperCase()}`],
    ["zip, not a uuid", "/media/zip/job-1"],
    ["zip, uuid plus digits", `/media/zip/${ZIP_UUID}1`],
    ["ZIP kind", `/media/ZIP/${ZIP_UUID}`],
    ["avatar", "/media/avatars/face.png"],
    ["embedded_media by uuid", `/media/embedded_media/${photo("alice/e2e_01").id}`],
    ["photo share thumbnail", `/api/public/photo/${m.shares.photo_share.slug}/media/thumbnail/`],
    ["photo share video of a still", `/api/public/photo/${m.shares.photo_share.slug}/media/video/`],
    ["photo share, bad kind", `/api/public/photo/${m.shares.photo_share.slug}/media/original/`],
    ["photo share, unknown slug", "/api/public/photo/no-such-slug/media/thumbnail/"],
  ];
  for (const [name, path] of extra) cases.push({ name, req: { path }, headers });
  return cases;
}

export type Pins = Partial<Record<Role, number>>;

/**
 * Django bugs (500s) the port does not reproduce; the value is what Rust
 * answers instead (what the same request gets for a photo with no file):
 * - a 36-character, four-dash name that is not a UUID reaches
 *   `Photo.objects.get(pk=...)` and raises ValidationError;
 * - a photo whose main_file was detached (removed) dereferences
 *   `photo.main_file` on None: embedded_media and the original.
 */
export const DJANGO_500: Record<string, Pins> = {
  "malformed uuid": { admin: 404, alice: 404, bob: 404, carol: 404, dave: 404, anonymous: 403 },
  "alice/removed embedded_media": { alice: 404 },
  "alice/removed photos": { alice: 404 },
  "alice/removed photos .jpg": { alice: 404 },
  "alice/removed photos .mp4": { alice: 404 },
};

export { BASE_URL, REF_URL };
