// Area upload (port of lp_api::upload, lp_db::upload, lp_db::write::upload):
// GET /api/exists/{md5+uid}, the chunked POST /api/upload/ and
// POST /api/upload/complete/.
//
// The two upload views are plain Django views in the original (the vendored
// django-chunked-upload), not DRF ones: errors are {"detail": ...} (plus
// offset on an offset mismatch), authentication failures are 403, and an
// unknown upload_id is Django's HTML 404.
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, copyFile, mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { config } from "~/lib/config";
import { client } from "~/lib/db";
import { cookieValue, json } from "~/lib/http";
import { enqueue } from "~/lib/jobs";
import { claimsUserId, decodeJwt } from "~/lib/jwt";
import { siteSettings } from "~/lib/settings";
import { parseClientDatetime } from "~/lib/time";
import { userById, type User } from "~/lib/users";
import { createNewImage, isValidMedia, md5File, targetPath } from "./ingest";

/** ChunkedUpload.UPLOADING / COMPLETE */
const UPLOADING = 1;
const COMPLETE = 2;

/** UploadPhotoExists.retrieve: only the requester's own library counts. */
export async function exists(user: User, hash: string) {
  const [r] = await client`SELECT EXISTS (SELECT 1 FROM api_photo WHERE owner_id = ${user.id} AND image_hash = ${hash}) AS e`;
  return { exists: r.e };
}

const detail = (status: number, msg: string) => json({ detail: msg }, status);
const forbidden = (msg: string) => detail(403, msg);
const badRequest = (msg: string) => detail(400, msg);

/** get_object_or_404 in a plain view: Django's default HTML page. */
const html404 = () =>
  new Response(
    '\n<!doctype html>\n<html lang="en">\n<head>\n  <title>Not Found</title>\n</head>\n<body>\n  <h1>Not Found</h1><p>The requested resource was not found on this server.</p>\n</body>\n</html>\n',
    { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );

/** SuspiciousFileOperation (an underivable file name): Django's 400 page. */
const html400 = () =>
  new Response(
    '\n<!doctype html>\n<html lang="en">\n<head>\n  <title>Bad Request (400)</title>\n</head>\n<body>\n  <h1>Bad Request (400)</h1><p></p>\n</body>\n</html>\n',
    { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );

/** authenticate_upload_request: header token first, else the jwt cookie; any unusable token is a 403. */
async function uploadUser(req: Request): Promise<User | Response> {
  const notProvided = () => forbidden("Authentication credentials were not provided");
  let token: string | undefined;
  const h = req.headers.get("authorization");
  if (h !== null) {
    const parts = h.split(/\s+/).filter(Boolean);
    if (parts[0]?.toLowerCase() === "bearer") {
      if (parts.length !== 2) return notProvided();
      token = parts[1];
    }
  }
  if (token === undefined) token = cookieValue(req, "jwt") || undefined;
  if (token === undefined) return notProvided();
  const claims = decodeJwt(token, "access");
  const invalid = () => forbidden("Authentication credentials were invalid");
  if (typeof claims === "string") return invalid();
  const uid = claimsUserId(claims);
  if (uid === null) return invalid();
  const user = await userById(uid);
  if (!user || !user.isActive) return notProvided();
  return user;
}

/**
 * UploaderScopedMixin.check_permissions, before the form is read (as in
 * Django). A refused request's body is still read before the answer: a
 * socket closed with unread data is reset, and a client still sending its
 * chunk would see a network error instead of the 403.
 */
async function authorized(req: Request): Promise<User | Response> {
  const settings = await siteSettings();
  const r = settings.ALLOW_UPLOAD ? await uploadUser(req) : forbidden("Uploading is not allowed");
  if (r instanceof Response) await req.arrayBuffer().catch(() => {});
  return r;
}

interface Form {
  fields: Map<string, string>;
  chunk: { name: string; data: Uint8Array } | null;
}

async function readForm(req: Request): Promise<Form | Response> {
  let fd: FormData;
  try {
    fd = await req.formData();
  } catch (e) {
    return badRequest(`Multipart form parse error - ${(e as Error).message}`);
  }
  const form: Form = { fields: new Map(), chunk: null };
  for (const [k, v] of fd.entries() as Iterable<[string, string | File]>) {
    if (typeof v === "string") form.fields.set(k, v);
    else if (k === "file" && !form.chunk) form.chunk = { name: v.name, data: new Uint8Array(await v.arrayBuffer()) };
  }
  return form;
}

/** ^bytes (?P<start>\d+)-(?P<end>\d+)/(?P<total>\d+)$ */
function contentRange(req: Request): [number, number, number] | null {
  const m = /^bytes (\d+)-(\d+)\/(\d+)\n?$/.exec(req.headers.get("content-range") ?? "");
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

interface ChunkedUpload {
  id: number;
  upload_id: string;
  file: string;
  offset: number;
  status: number;
  expired: boolean;
  expires: string;
}

/** DjangoJSONEncoder datetime: milliseconds (when there are microseconds), Z. */
const UPLOAD_COLUMNS = (t: string) =>
  `${t}.id, ${t}.upload_id, ${t}.file, ${t}."offset"::float8 AS "offset", ${t}.status,
   ${t}.created_on + interval '1 day' <= now() AS expired,
   to_char((${t}.created_on + interval '1 day') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS')
     || CASE WHEN extract(microseconds FROM ${t}.created_on)::bigint % 1000000 <> 0
          THEN to_char((${t}.created_on + interval '1 day') AT TIME ZONE 'UTC', '.MS') ELSE '' END || 'Z' AS expires`;

/** The user's upload by upload_id (uploads are scoped to their uploader). */
async function chunkedUpload(userId: number, uploadId: string): Promise<ChunkedUpload | undefined> {
  const r = await client.unsafe(`SELECT ${UPLOAD_COLUMNS("c")} FROM chunked_upload_chunkedupload c WHERE c.upload_id = $1 AND c.user_id = $2`, [
    uploadId,
    userId,
  ]);
  return r[0];
}

const responseData = (u: ChunkedUpload) => ({ upload_id: u.upload_id, offset: u.offset, expires: u.expires });

/** ChunkedUploadView._post */
export async function uploadChunk(req: Request): Promise<Response> {
  const user = await authorized(req);
  if (user instanceof Response) return user;
  const form = await readForm(req);
  if (form instanceof Response) return form;
  if (!form.chunk) return badRequest("No chunk file was submitted");
  const id = form.fields.get("upload_id");
  let existing: ChunkedUpload | undefined;
  if (id) {
    existing = await chunkedUpload(user.id, id);
    if (!existing) return html404();
    if (existing.expired) return detail(410, "Upload has expired");
    if (existing.status === COMPLETE) return badRequest('Upload has already been marked as "complete"');
  }
  const chunk = form.chunk.data;
  const size = chunk.length;
  const [start, end] = contentRange(req) ?? [0, size - 1, size];
  const chunkSize = end - start + 1;
  const offset = existing?.offset ?? 0;
  if (offset !== start) return json({ detail: "Offsets do not match", offset }, 400);
  if (size !== chunkSize) return badRequest("File size doesn't match headers");
  const uploadId = existing?.upload_id ?? randomUUID().replace(/-/g, "");
  const file = existing?.file ?? `chunked_uploads/${uploadId}.part`;
  const p = path.join(config.mediaRoot, file);
  await mkdir(path.dirname(p), { recursive: true });
  await appendFile(p, chunk);
  let row: ChunkedUpload;
  if (existing) {
    await client`UPDATE chunked_upload_chunkedupload SET "offset" = ${existing.offset + chunkSize} WHERE id = ${existing.id}`;
    row = { ...existing, offset: existing.offset + chunkSize };
  } else {
    const r = await client.unsafe(
      `INSERT INTO chunked_upload_chunkedupload AS c (upload_id, file, filename, "offset", created_on, status, user_id)
       VALUES ($1, $2, $3, $4, now(), $5, $6) RETURNING ${UPLOAD_COLUMNS("c")}`,
      [uploadId, file, form.chunk.name, chunkSize, UPLOADING, user.id],
    );
    row = r[0];
  }
  return json(responseData(row), 200);
}

/** Django's get_valid_filename. */
function validFilename(name: string): string | null {
  const s = Array.from(name.trim().replace(/ /g, "_"))
    .filter((c) => /[\p{L}\p{N}_.-]/u.test(c))
    .join("");
  return !s || s === "." || s === ".." ? null : s;
}

/** parse_device_timestamp: epoch milliseconds or ISO 8601, as chrono serializes it (UTC, Z). */
function parseDeviceTimestamp(raw: string | undefined): string | null {
  const t = raw?.trim();
  if (!t) return null;
  let d: Date | null = null;
  const digits = t.replace(/_/g, "");
  if (/^[+-]?\d+$/.test(digits)) d = new Date(Number(digits));
  else {
    const iso = parseClientDatetime(t);
    if (iso) d = new Date(iso);
  }
  if (!d || Number.isNaN(d.getTime())) return null;
  const s = d.toISOString();
  return d.getUTCMilliseconds() ? s : s.replace(".000Z", "Z");
}

async function deleteUpload(id: number, staged: string) {
  await client`DELETE FROM chunked_upload_chunkedupload WHERE id = ${id}`;
  await unlink(staged).catch((e: NodeJS.ErrnoException) => {
    if (e.code !== "ENOENT") throw e;
  });
}

/** ChunkedUploadCompleteView._post + UploadPhotosChunkedComplete.on_completion. */
export async function uploadComplete(req: Request): Promise<Response> {
  const user = await authorized(req);
  if (user instanceof Response) return user;
  const form = await readForm(req);
  if (form instanceof Response) return form;
  const uploadId = form.fields.get("upload_id");
  const md5 = form.fields.get("md5");
  if (!uploadId || !md5) return badRequest("Both 'upload_id' and 'md5' are required");
  const upload = await chunkedUpload(user.id, uploadId);
  if (!upload) return html404();
  if (upload.status === COMPLETE) return badRequest("Upload has already been marked as complete");
  const staged = path.join(config.mediaRoot, upload.file);
  const actual = await md5File(staged);
  if (actual !== md5) return badRequest("md5 checksum does not match");
  // Two concurrent completions both pass the status check above; only the one that flips the row imports the file.
  const won = await client`UPDATE chunked_upload_chunkedupload SET status = ${COMPLETE}, completed_on = now()
    WHERE id = ${upload.id} AND status <> ${COMPLETE} RETURNING 1`;
  if (!won.length) return badRequest("Upload has already been marked as complete");

  // A ChunkedUploadError hands the upload id back so a retry can complete it.
  const refused = async (r: Response) => {
    await client`UPDATE chunked_upload_chunkedupload SET status = ${UPLOADING}, completed_on = NULL WHERE upload_id = ${upload.upload_id}`;
    return r;
  };
  const scanDir = user.scanDirectory;
  if (!scanDir.trim()) {
    return refused(
      badRequest(
        "Upload failed: No scan directory configured. Please contact your administrator to set up a scan directory for your account.",
      ),
    );
  }
  if (!existsSync(scanDir)) {
    return refused(badRequest(`Upload failed: Scan directory '${scanDir}' does not exist. Please contact your administrator.`));
  }
  if (!(await isValidMedia(staged))) {
    await deleteUpload(upload.id, staged);
    return refused(badRequest("File type not allowed"));
  }
  const filename = validFilename(form.fields.get("filename") ?? "None");
  if (!filename) return html400();
  const device = "web";
  await mkdir(path.join(scanDir, "uploads", device), { recursive: true });
  const imageHash = `${actual}${user.id}`;
  const target = await targetPath(scanDir, user.id, device, filename, imageHash);
  if (target) await copyFile(staged, target);
  await deleteUpload(upload.id, staged);
  if (!target) {
    console.log(`photo duplicated, no new import: ${filename} ${imageHash}`);
    return json({}, 200);
  }
  const photo = await createNewImage(user.id, target);
  if (photo) {
    await enqueue("upload.process", {
      user_id: user.id,
      photo_id: photo,
      path: target,
      device_created_at: parseDeviceTimestamp(form.fields.get("device_created_at")),
    });
  }
  return json({}, 200);
}
