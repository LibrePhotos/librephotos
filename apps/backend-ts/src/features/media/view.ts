// /media/<path>/<fname>: port of UnifiedMediaAccessView (api/views/media.py)
// via lp_media::view. Dispatch, photo lookup (hash, UUID on derived paths,
// several owners sharing one hash), the grant order, refusal semantics and
// the per-mode delivery, with every file path confined to its root instead
// of joined from raw URL text.
import { existsSync } from "node:fs";
import { config } from "~/lib/config";
import { mayAccess } from "~/lib/scope";
import { embeddedMediaPath, photoById, photosByHash, photosWithMe, type MediaPhoto, type PhotoKey } from "./queries";
import { definite, requester, settleClaim, type Requester, type Viewer } from "./requester";
import { mimeType } from "./mime";
import { MEDIA_ROOT } from "./paths";
import { basename, ext, headerValue, iriToUri, pjoin, quote } from "./pyfmt";
import { empty, fileRequest, forbiddenUnauthenticated, refuse, serveFile, xAccel, type FileRequest } from "./serve";
import { cachedPath, liveResponse } from "./transcode";


/** Request facts every branch needs. */
export interface MediaCtx {
  proxy: boolean;
  head: boolean;
  range: string | null;
}

export const mediaCtx = (request: Request): MediaCtx => ({
  proxy: config.mediaMode !== "direct",
  head: request.method === "HEAD",
  range: request.headers.get("range"),
});

const file = (ctx: MediaCtx, req: FileRequest) => serveFile(req, ctx.range, ctx.head);

/** A request-derived relative directory: "/"-separated plain segments only. */
function safeDir(p: string): boolean {
  if (p === "") return false;
  return p
    .replace(/^\/+/, "")
    .split("/")
    .every((seg) => seg !== "" && seg !== "." && seg !== ".." && !/[\\:\0]/.test(seg));
}

/** A request-derived file name: one plain path component. */
const safeName = (name: string) => name !== "" && name !== "." && name !== ".." && !/[/\\:\0]/.test(name);

interface Protected {
  file: string;
  root: string;
  uri: string;
}

/**
 * MEDIA_ROOT/<path>/<name> and its /protected_media/<path>/<name> hand-off,
 * or undefined when either part could escape the media root.
 */
function protectedFile(p: string, name: string): Protected | undefined {
  if (!safeDir(p) || !safeName(name)) return undefined;
  const rel = p.replace(/^\/+/, "");
  let dir = MEDIA_ROOT;
  for (const seg of rel.split("/")) dir = pjoin(dir, seg);
  return { file: pjoin(dir, name), root: dir, uri: `/protected_media/${rel}/${name}` };
}

/** A Thumbnail FileField's file (field.path), confined to MEDIA_ROOT. */
const stored = (name: string, contentType?: string) => fileRequest(pjoin(MEDIA_ROOT, name), MEDIA_ROOT, contentType);

/** Where a photo's original may be read from: the library, its owner's scan directory, or the media root. */
function originalRoots(photo: MediaPhoto): string[] {
  const roots = [config.photos, MEDIA_ROOT];
  if (photo.owner_scan_directory) roots.push(photo.owner_scan_directory);
  return roots;
}

/** _thumbnail_field_for: the stored name `path` asks for, undefined when absent or empty. */
function thumbnailField(photo: MediaPhoto, p: string): string | undefined {
  const field = p.includes("thumbnails_big")
    ? photo.thumbnail_big
    : p.includes("square_thumbnails_small")
      ? photo.square_thumbnail_small
      : photo.square_thumbnail;
  return field ? field : undefined;
}

/** _transcoded_video_response. */
async function transcoded(ctx: MediaCtx, photo: MediaPhoto): Promise<Response> {
  if (photo.main_file_path === null) return empty(404);
  const cached = cachedPath(photo.image_hash);
  if (cached) {
    if (ctx.proxy) return xAccel("video/mp4", `/protected_media/transcoded/${basename(cached)}`);
    return file(ctx, fileRequest(cached, MEDIA_ROOT, "video/mp4"));
  }
  return liveResponse({ imageHash: photo.image_hash, path: photo.main_file_path, videoLength: photo.video_length }, ctx.head);
}

/** _generate_response_proxy. */
async function generateProxy(ctx: MediaCtx, photo: MediaPhoto, p: string, fname: string, transcodeVideos: boolean): Promise<Response> {
  if (p.includes("thumbnail")) {
    const thumb = thumbnailField(photo, p);
    if (p.includes("thumbnails_big")) {
      const name = thumb !== undefined ? basename(thumb) : `${fname}.webp`;
      const ct = ext(name).includes("jpg") ? "image/jpeg" : "image/webp";
      const pf = protectedFile(p, name);
      return pf ? xAccel(ct, pf.uri) : empty(404);
    }
    if (thumb === undefined) {
      const [suffix, ct] = photo.video ? [".mp4", "video/mp4"] : [".webp", "image/webp"];
      const pf = protectedFile(p, `${fname}${suffix}`);
      return pf ? xAccel(ct, pf.uri) : empty(404);
    }
    const e = ext(thumb);
    if (e.includes("jpg")) {
      // Django hands nginx a filesystem path here; reproduced as is.
      const big = thumbnailField(photo, "thumbnails_big") ?? thumb;
      return xAccel("image/jpg", pjoin(MEDIA_ROOT, big));
    }
    let ct: string;
    if (e.includes("webp")) ct = "image/webp";
    else if (e.includes("mp4")) ct = "video/mp4";
    else return empty(200);
    const pf = protectedFile(p, basename(thumb));
    return pf ? xAccel(ct, pf.uri) : empty(404);
  }
  if (p.includes("faces")) {
    const pf = protectedFile(p, fname);
    return pf ? xAccel("image/jpg", pf.uri) : empty(404);
  }
  if (photo.video) {
    if (transcodeVideos) return transcoded(ctx, photo);
    const main = photo.main_file_path;
    if (main === null) return empty(404);
    const target = main.split(config.photos).join("/original");
    return xAccel(mimeType(main), iriToUri(target));
  }
  const pf = protectedFile(p, fname);
  return pf ? xAccel("image/jpg", pf.uri) : empty(404);
}

/** _thumbnail_response_direct: which file to serve. undefined = 404. */
function thumbnailDirectFile(photo: MediaPhoto, p: string, fname: string): FileRequest | undefined {
  const bigJpg = (fallback: string) => stored(thumbnailField(photo, "thumbnails_big") ?? fallback, "image/jpg");
  // _stored_thumbnail_response
  const thumb = thumbnailField(photo, p);
  if (thumb !== undefined) {
    const e = ext(thumb);
    if (e.includes("jpg")) return bigJpg(thumb);
    const full = pjoin(MEDIA_ROOT, thumb);
    if (existsSync(full)) return fileRequest(full, MEDIA_ROOT, e.includes("mp4") ? "video/mp4" : "image/webp");
  }
  const requested = protectedFile(p, fname);
  if (!requested) return undefined;
  if (!existsSync(requested.file)) {
    for (const [suffix, ct] of [
      [".webp", "image/webp"],
      [".mp4", "video/mp4"],
    ] as const) {
      if (fname.endsWith(suffix)) continue;
      const candidate = pjoin(requested.root, `${fname}${suffix}`);
      if (existsSync(candidate)) return fileRequest(candidate, requested.root, ct);
    }
  }
  const square = thumbnailField(photo, "square_thumbnails");
  if (square !== undefined && ext(square).includes("jpg")) return bigJpg(square);
  return fileRequest(requested.file, requested.root);
}

/** _generate_response_direct. */
async function generateDirect(ctx: MediaCtx, photo: MediaPhoto, p: string, fname: string, transcodeVideos: boolean): Promise<Response> {
  if (p.includes("thumbnail")) {
    const req = thumbnailDirectFile(photo, p, fname);
    return req ? file(ctx, req) : empty(404);
  }
  if (p.includes("faces")) {
    const pf = protectedFile(p, fname);
    return pf ? file(ctx, fileRequest(pf.file, pf.root, "image/jpg")) : empty(404);
  }
  if (photo.video) {
    if (transcodeVideos) return transcoded(ctx, photo);
    if (photo.main_file_path === null) return empty(404);
    return file(ctx, { path: photo.main_file_path, roots: originalRoots(photo) });
  }
  const pf = protectedFile(p, fname);
  return pf ? file(ctx, fileRequest(pf.file, pf.root, "image/jpg")) : empty(404);
}

/** _generate_response. */
export const generate = (ctx: MediaCtx, photo: MediaPhoto, p: string, fname: string, transcodeVideos: boolean) =>
  ctx.proxy ? generateProxy(ctx, photo, p, fname, transcodeVideos) : generateDirect(ctx, photo, p, fname, transcodeVideos);

/** _generate_response_original: the untouched original (path == "photos"). */
export async function generateOriginal(ctx: MediaCtx, photo: MediaPhoto, transcodeVideos: boolean, inline: boolean): Promise<Response> {
  if (photo.video && transcodeVideos) return transcoded(ctx, photo);
  const main = photo.main_file_path;
  if (main === null) return empty(404);
  if (!ctx.proxy) return file(ctx, { path: main, roots: originalRoots(photo) });
  const ct = photo.video ? mimeType(main) : "image/webp";
  let internal: string;
  if (main.startsWith("/nextcloud_media/")) {
    // Django slices 21 characters off a 17-character prefix.
    internal = `/nextcloud_original${main.slice(21)}`;
  } else if (main.startsWith(config.photos)) {
    internal = `/original${main.slice(config.photos.length)}`;
  } else {
    internal = quote(main, "/");
  }
  const res = xAccel(ct, iriToUri(internal));
  if (inline) {
    const name = main.slice(main.lastIndexOf("/") + 1);
    res.headers.set("Content-Disposition", headerValue(`inline; filename="${name}"`));
  }
  return res;
}

const isUuidFormat = (v: string) => [...v].length === 36 && v.split("-").length === 5;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Canonical hyphenated lower-case UUID of a 36-character hyphenated form, or undefined. */
const parseUuid = (v: string) => (UUID_RE.test(v) ? v.toLowerCase() : undefined);

/** _pick_visible_photo: the requester's own row, then one shared to them, then one anyone may see; else the first. */
function pick(candidates: MediaPhoto[], signedIn: boolean): MediaPhoto | undefined {
  if (candidates.length <= 1) return candidates[0];
  let i = -1;
  if (signedIn) {
    i = candidates.findIndex((p) => p.is_owner);
    if (i < 0) i = candidates.findIndex((p) => p.shared_directly);
  }
  if (i < 0) i = candidates.findIndex((p) => p.in_public_album || p.is_public_photo);
  return candidates[i < 0 ? 0 : i];
}

/**
 * _lookup_photo, plus the requester made definite: a claimed token's user is
 * checked in the same statement (one query on the hot path).
 */
async function lookup(
  request: Request,
  req: Requester,
  imageHash: string,
  allowUuid: boolean,
): Promise<{ photo: MediaPhoto | undefined; viewer: Viewer | null }> {
  let key: { hash: string } | { id: string } | undefined = { hash: imageHash };
  if (allowUuid && isUuidFormat(imageHash)) {
    const id = parseUuid(imageHash);
    key = id === undefined ? undefined : { id };
  }
  let viewer: Viewer | null;
  if (req.kind === "claimed" && key !== undefined) {
    const found = await photosWithMe(key, req.uid);
    const settled = await settleClaim(request, req, found.me);
    if (settled.trusted) return { photo: "id" in key ? found.photos[0] : pick(found.photos, true), viewer: settled.viewer };
    viewer = settled.viewer;
  } else viewer = await definite(request, req);
  if (key === undefined) return { photo: undefined, viewer };
  const uid = viewer?.id ?? null;
  const photo = "id" in key ? await photoById(key.id, uid) : pick(await photosByHash(key.hash, uid), viewer !== null);
  return { photo, viewer };
}

/** zip_file_name: <canonical uuid><user id>.zip, undefined for anything else. */
export function zipFileName(fileUuid: string, userId: number): string | undefined {
  const canonical = parseUuid(fileUuid);
  return canonical === undefined ? undefined : `${canonical}${userId}.zip`;
}

function serveZip(ctx: MediaCtx, user: Viewer | null, p: string, fname: string): Response {
  if (!user) return forbiddenUnauthenticated();
  const filename = zipFileName(fname, user.id);
  if (!filename) return empty(404);
  const pf = protectedFile(p, filename);
  if (!pf) return empty(404);
  if (ctx.proxy) return xAccel("application/x-zip-compressed", pf.uri);
  return file(ctx, fileRequest(pf.file, pf.root, "application/x-zip-compressed"));
}

function serveAvatar(ctx: MediaCtx, user: Viewer | null, p: string, fname: string): Response {
  if (!user) return forbiddenUnauthenticated();
  const pf = protectedFile(p, fname);
  if (!pf) return empty(404);
  if (ctx.proxy) return xAccel("image/png", pf.uri);
  return file(ctx, fileRequest(pf.file, pf.root, "image/png"));
}

async function serveEmbedded(ctx: MediaCtx, user: Viewer | null, p: string, fname: string): Promise<Response> {
  let key: PhotoKey;
  if (isUuidFormat(fname)) {
    const id = parseUuid(fname);
    if (id === undefined) return empty(404);
    key = { id };
  } else key = { hash: fname };
  const embedded = await embeddedMediaPath(key, user?.id ?? null);
  if (embedded === undefined || embedded === null) return empty(404);
  if (ctx.proxy) {
    const pf = protectedFile(p, basename(embedded));
    return pf ? xAccel("video/mp4", pf.uri) : empty(404);
  }
  return file(ctx, fileRequest(embedded, MEDIA_ROOT, "video/mp4"));
}

async function serveDerived(request: Request, ctx: MediaCtx, req: Requester, imageHash: string, p: string, fname: string): Promise<Response> {
  const { photo, viewer } = await lookup(request, req, imageHash, true);
  if (!photo) return refuse(viewer !== null);
  if (photo.in_public_album) return generate(ctx, photo, p, fname, false);
  if (viewer && mayAccess(photo)) return generate(ctx, photo, p, fname, viewer.transcodeVideos);
  if (photo.is_public_photo) return generate(ctx, photo, p, fname, false);
  return refuse(viewer !== null);
}

async function serveOriginal(request: Request, ctx: MediaCtx, req: Requester, imageHash: string): Promise<Response> {
  const { photo, viewer } = await lookup(request, req, imageHash, false);
  if (!photo) return refuse(viewer !== null);
  if (photo.in_public_album) return generateOriginal(ctx, photo, false, false);
  if (viewer) {
    if (photo.is_owner || photo.shared_directly) return generateOriginal(ctx, photo, viewer.transcodeVideos, true);
    if (mayAccess(photo)) return generateOriginal(ctx, photo, viewer.transcodeVideos, false);
  }
  if (photo.is_public_photo) return generateOriginal(ctx, photo, false, false);
  return refuse(viewer !== null);
}

/**
 * Django's _url_segment_traverses (#2122): a backslash or a `..` component
 * in either URL segment is always an attempt to leave the media directory,
 * refused with a 404 before anything is looked up. The joins are confined
 * on their own (safeDir, protectedFile, confined); this keeps the answers
 * identical to Django's, e.g. for `<hash>_%5C..%5Cx`, which would otherwise
 * serve the photo by its hash.
 */
const traverses = (segment: string) => segment.includes("\\") || segment.split("/").some((part) => part === "..");

/**
 * The text after /media/ in the raw request path, percent-decoded once (as
 * the router would), one trailing slash dropped. undefined = undecodable.
 */
export function mediaRest(url: URL): string | undefined {
  let rest = url.pathname.slice("/media/".length);
  if (rest.endsWith("/")) rest = rest.slice(0, -1);
  try {
    return decodeURIComponent(rest);
  } catch {
    return undefined;
  }
}

/**
 * GET|HEAD /media/{*rest}. Authentication runs first, as on Django (a bad
 * bearer token is a 401 whatever the path).
 */
export async function media(request: Request, url: URL): Promise<Response> {
  const req = await requester(request);
  const rest = mediaRest(url);
  const ctx = mediaCtx(request);
  // Django's ^media/(?P<path>.*)/(?P<fname>.*): everything up to the last slash is the path.
  const slash = rest === undefined ? -1 : rest.lastIndexOf("/");
  const [p, fname] = rest === undefined ? ["", ""] : slash < 0 ? [rest, ""] : [rest.slice(0, slash), rest.slice(slash + 1)];
  if (rest === undefined || traverses(p) || traverses(fname)) {
    await definite(request, req);
    return empty(404);
  }
  switch (p.toLowerCase()) {
    case "zip":
      return serveZip(ctx, await definite(request, req), p, fname);
    case "avatars":
      return serveAvatar(ctx, await definite(request, req), p, fname);
    case "embedded_media":
      return serveEmbedded(ctx, await definite(request, req), p, fname);
  }
  // Django joins this text into file paths and X-Accel targets; a path that
  // could climb out of MEDIA_ROOT names nothing we serve.
  if (!safeDir(p)) {
    await definite(request, req);
    return empty(404);
  }
  const imageHash = fname.split(".")[0]!.split("_")[0]!;
  if (p.toLowerCase() !== "photos") return serveDerived(request, ctx, req, imageHash, p, fname);
  return serveOriginal(request, ctx, req, imageHash);
}
