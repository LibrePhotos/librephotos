// GET /api/photo/share/list and POST /api/photo/share: public photo links
// (public_photos.PhotoShareList / SetPhotoShare). Port of
// lp_api::photo_edits::photo_share + lp_db::write::photo_edits::sharing
// (enable_share / disable_share).
import { sql } from "drizzle-orm";
import { db, row, rows, type Tx } from "~/lib/db";
import { json, jsonBody } from "~/lib/http";
import { ApiError } from "~/lib/errors";
import { pyTruthy } from "~/lib/query";
import { drfTs } from "~/lib/time";
import type { User } from "~/lib/users";

interface ShareRow {
  id: number;
  enabled: boolean;
  slug: string | null;
  created_at: string;
  photo_id: string;
  image_hash: string;
}

/** `_share_payload`. */
function payload(s: ShareRow | undefined): Record<string, unknown> {
  if (s && s.enabled && s.slug) {
    return { enabled: true, slug: s.slug, url: `/public/p/${s.slug}`, created_at: s.created_at };
  }
  return { enabled: false, slug: null, url: null };
}

export async function shareList(user: User) {
  const shares = await rows<ShareRow>(sql`SELECT s.id, s.enabled, s.slug, ${drfTs("s.created_at")} AS created_at, s.photo_id, p.image_hash
    FROM api_photoshare s JOIN api_photo p ON p.id = s.photo_id
    WHERE p.owner_id = ${user.id} AND s.enabled AND s.slug IS NOT NULL
    ORDER BY s.created_at DESC, s.id DESC`);
  return { results: shares.map((s) => ({ ...payload(s), photo_id: s.photo_id, image_hash: s.image_hash })) };
}

const statusMessage = (status: number, message: string) => json({ status: false, message }, status);

/** uuid.UUID(str) forms: hyphenated, 32 hex, braced, urn:uuid:. */
function parseUuid(s: string): string | null {
  const t = s.replace(/^urn:uuid:/i, "").replace(/^\{(.*)\}$/, "$1");
  const hex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t) ? t.replaceAll("-", "") : t;
  return /^[0-9a-f]{32}$/i.test(hex) ? hex.toLowerCase() : null;
}

/** secrets.token_urlsafe(9): 12 URL-safe characters. */
const tokenUrlsafe9 = () => Buffer.from(crypto.getRandomValues(new Uint8Array(9))).toString("base64url");

async function freshSlug(tx: Tx): Promise<string> {
  for (;;) {
    const candidate = tokenUrlsafe9();
    const taken = await row<{ t: boolean }>(sql`SELECT EXISTS (SELECT 1 FROM api_photoshare WHERE slug = ${candidate}) AS t`, tx);
    if (!taken?.t) return candidate;
  }
}

const RETURNING = sql`RETURNING id, enabled, slug, ${drfTs("created_at")} AS created_at, photo_id,
  (SELECT image_hash FROM api_photo WHERE id = photo_id) AS image_hash`;

/** enable (rotate = false) or rotate: the share exists, is enabled and has a slug; rotate mints a new one. */
async function enableShare(tx: Tx, photoId: string, rotate: boolean): Promise<ShareRow> {
  const existing = await row<{ id: number; slug: string | null }>(
    sql`SELECT id, slug FROM api_photoshare WHERE photo_id = ${photoId}::uuid FOR UPDATE`,
    tx,
  );
  if (!existing) {
    const slug = await freshSlug(tx);
    return (await row<ShareRow>(
      sql`INSERT INTO api_photoshare (enabled, slug, created_at, photo_id) VALUES (TRUE, ${slug}, now(), ${photoId}::uuid) ${RETURNING}`,
      tx,
    ))!;
  }
  const slug = existing.slug !== null && !rotate ? existing.slug : await freshSlug(tx);
  return (await row<ShareRow>(sql`UPDATE api_photoshare SET enabled = TRUE, slug = ${slug} WHERE id = ${existing.id} ${RETURNING}`, tx))!;
}

export async function setShare(user: User, request: Request) {
  const body = await jsonBody<unknown>(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw ApiError.badRequest("non_field_errors", "Invalid data. Expected a dictionary.");
  }
  const b = body as Record<string, unknown>;
  const photoId = b.photo_id;
  if (typeof photoId !== "string" || !photoId) return statusMessage(400, "Missing parameters");
  let action = "enable";
  if (b.action !== undefined && pyTruthy(b.action)) {
    const a = typeof b.action === "string" ? b.action.toLowerCase() : "";
    if (!["enable", "rotate", "disable"].includes(a)) return statusMessage(400, "Unknown action");
    action = a;
  }
  // public_photos._owned_photo: a UUID pk first, then an image hash.
  const pk = parseUuid(photoId);
  const photo = await row<{ id: string }>(sql`SELECT p.id FROM api_photo p WHERE p.owner_id = ${user.id}
    AND ${pk !== null ? sql`(p.id = ${pk}::uuid OR p.image_hash = ${photoId})` : sql`p.image_hash = ${photoId}`}
    ORDER BY ${pk !== null ? sql`(p.id = ${pk}::uuid) DESC, ` : sql``}p.id LIMIT 1`);
  if (!photo) return statusMessage(404, "No such photo");
  const share = await db.transaction(async (tx) =>
    action === "disable"
      ? row<ShareRow>(sql`UPDATE api_photoshare SET enabled = FALSE, slug = NULL WHERE photo_id = ${photo.id}::uuid ${RETURNING}`, tx)
      : enableShare(tx, photo.id, action === "rotate"),
  );
  return { status: true, share: payload(share) };
}
