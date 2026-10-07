// SQL of the users_settings area (port of lp_db::users_settings and
// lp_db::write::users_settings / users). Reads return snake_case rows with
// DRF-formatted datetimes; the per-user photo numbers ride along as
// correlated subqueries, so a profile is one statement.
import { sql, type SQL } from "drizzle-orm";
import { db, jsonbParam, row, rows, type Db, type Tx } from "~/lib/db";
import { drfTs } from "~/lib/time";
import { encryptStr } from "./crypto";
import {
  USER_BURST_DETECTION_RULES,
  USER_DATETIME_RULES,
  USER_LLM_SETTINGS,
  USER_PUBLIC_SHARING_DEFAULTS,
} from "./static_payloads";

export interface PhotoSample {
  image_hash: string;
  rating: number;
  hidden: boolean;
  exif_timestamp: string | null;
  public: boolean;
  video: boolean;
}

/** An api_user row (without nextcloud_app_password) plus its photo numbers. */
export interface UserRow {
  id: number;
  password: string;
  last_login: string | null;
  is_superuser: boolean;
  username: string;
  first_name: string;
  last_name: string;
  email: string;
  is_staff: boolean;
  is_active: boolean;
  date_joined: string;
  scan_directory: string;
  avatar: string | null;
  nextcloud_server_address: string;
  nextcloud_username: string;
  nextcloud_scan_directory: string;
  confidence: number;
  semantic_search_topk: number;
  favorite_min_rating: number;
  image_scale: number;
  save_metadata_to_disk: string;
  transcode_videos: boolean;
  datetime_rules: unknown;
  default_timezone: string;
  confidence_person: number;
  public_sharing: boolean;
  confidence_unknown_face: number;
  min_cluster_size: number;
  cluster_selection_epsilon: number;
  min_samples: number;
  llm_settings: unknown;
  text_alignment: string;
  header_size: string;
  skip_raw_files: boolean;
  slideshow_interval: number;
  duplicate_clear_existing: boolean;
  duplicate_sensitivity: string;
  burst_detection_rules: unknown;
  stack_raw_jpeg: boolean;
  public_sharing_defaults: unknown;
  save_face_tags_to_disk: boolean;
  photo_count: number;
  public_photo_count: number;
  public_photo_samples: PhotoSample[];
}

const USER_COLS = sql.raw(
  [
    "u.id, u.password, u.is_superuser, u.username, u.first_name, u.last_name, u.email, u.is_staff, u.is_active",
    "u.scan_directory, u.avatar, u.nextcloud_server_address, u.nextcloud_username, u.nextcloud_scan_directory",
    "u.confidence, u.semantic_search_topk, u.favorite_min_rating, u.image_scale, u.save_metadata_to_disk",
    "u.transcode_videos, u.datetime_rules, u.default_timezone, u.confidence_person, u.public_sharing",
    "u.confidence_unknown_face, u.min_cluster_size, u.cluster_selection_epsilon, u.min_samples, u.llm_settings",
    "u.text_alignment, u.header_size, u.skip_raw_files, u.slideshow_interval, u.duplicate_clear_existing",
    "u.duplicate_sensitivity, u.burst_detection_rules, u.stack_raw_jpeg, u.public_sharing_defaults",
    "u.save_face_tags_to_disk",
  ].join(", "),
);

/**
 * PhotoQuerySet.owned_by(u) counts and `.filter(public=True)[:10]` samples
 * (PhotoSuperSimpleSerializer), per user row `u`. Two scalar counts each use
 * the owner index; one FILTER aggregate would scan the owner's photos.
 */
const STATS_COLS = sql`(SELECT count(*) FROM api_photo p WHERE p.owner_id = u.id)::int AS photo_count,
  (SELECT count(*) FROM api_photo p WHERE p.owner_id = u.id AND p.public)::int AS public_photo_count,
  COALESCE((SELECT json_agg(json_build_object('image_hash', s.image_hash, 'rating', s.rating, 'hidden', s.hidden,
      'exif_timestamp', ${drfTs(sql`s.exif_timestamp`)}, 'public', s.public, 'video', s.video))
    FROM (SELECT p.image_hash, p.rating, p.hidden, p.exif_timestamp, p.public, p.video
          FROM api_photo p WHERE p.owner_id = u.id AND p.public LIMIT 10) s), '[]'::json) AS public_photo_samples`;

/** ManageUserSerializer needs only photo_count. */
const COUNT_COL = sql`(SELECT count(*) FROM api_photo p WHERE p.owner_id = u.id)::int AS photo_count`;
export type Stats = "full" | "count";
const statsCols = (s: Stats) => (s === "full" ? STATS_COLS : COUNT_COL);

const SELECT_USER = sql`SELECT ${USER_COLS}, ${drfTs(sql`u.last_login`)} AS last_login, ${drfTs(sql`u.date_joined`)} AS date_joined`;

/** Which users GET /api/user/ may return (UserViewSet.get_queryset). */
export type UserScope = "active" | "public" | "all";

function scopeSql(scope: UserScope): SQL {
  if (scope === "all") return sql`TRUE`;
  if (scope === "public") return sql`u.is_active AND u.public_sharing`;
  return sql`u.is_active`;
}

/** One user with its photo numbers, restricted to `scope` (404 = undefined). */
export function userWithStats(id: number, scope: UserScope, stats: Stats = "full", tx: Db | Tx = db): Promise<UserRow | undefined> {
  return row<UserRow>(sql`${SELECT_USER}, ${statsCols(stats)} FROM api_user u WHERE ${scopeSql(scope)} AND u.id = ${id}`, tx);
}

/** A LimitOffset page ordered by id plus the total count (two statements, run together). */
export async function listUsers(scope: UserScope, limit: number, offset: number, stats: Stats = "full"): Promise<{ count: number; users: UserRow[] }> {
  const [c, users] = await Promise.all([
    row<{ n: number }>(sql`SELECT count(*)::int AS n FROM api_user u WHERE ${scopeSql(scope)}`),
    rows<UserRow>(sql`${SELECT_USER}, ${statsCols(stats)} FROM api_user u WHERE ${scopeSql(scope)} ORDER BY u.id LIMIT ${limit} OFFSET ${offset}`),
  ]);
  return { count: c?.n ?? 0, users };
}

/** not User.objects.filter(is_superuser=True).exists() */
export async function isFirstTimeSetup(tx: Db | Tx = db): Promise<boolean> {
  const r = await row<{ any: boolean }>(sql`SELECT EXISTS (SELECT 1 FROM api_user WHERE is_superuser) AS any`, tx);
  return !r?.any;
}

/** DRF UniqueValidator on username (another user with exactly this name). */
export async function usernameTakenByOther(username: string, excludeId: number | null): Promise<boolean> {
  const r = await row<{ t: boolean }>(
    sql`SELECT EXISTS (SELECT 1 FROM api_user WHERE username = ${username} AND (${excludeId}::int IS NULL OR id <> ${excludeId}::int)) AS t`,
  );
  return !!r?.t;
}

export interface ScanDirectoryOwner {
  id: number;
  username: string;
  scan_directory: string;
}

/** Every other user with a scan directory (reject_overlap_with_another_user). */
export function otherScanDirectories(excludeId: number | null): Promise<ScanDirectoryOwner[]> {
  return rows<ScanDirectoryOwner>(
    sql`SELECT id, username, scan_directory FROM api_user WHERE scan_directory <> '' AND (${excludeId}::int IS NULL OR id <> ${excludeId}::int) ORDER BY id`,
  );
}

/** User.objects.filter(email__iexact=email).first() */
export function userByEmailIexact(email: string): Promise<UserRow | undefined> {
  return row<UserRow>(sql`${SELECT_USER} FROM api_user u WHERE upper(u.email) = upper(${email}) ORDER BY u.id LIMIT 1`);
}

/** A plain user row (no photo numbers). */
export function plainUser(id: number, tx: Db | Tx = db): Promise<UserRow | undefined> {
  return row<UserRow>(sql`${SELECT_USER} FROM api_user u WHERE u.id = ${id}`, tx);
}

/** Exact username match (get_by_natural_key), plain row. */
export function plainUserByUsername(username: string): Promise<UserRow | undefined> {
  return row<UserRow>(sql`${SELECT_USER} FROM api_user u WHERE u.username = ${username}`);
}

export async function tableExists(table: string, tx: Db | Tx = db): Promise<boolean> {
  const r = await row<{ e: boolean }>(sql`SELECT to_regclass(${"public." + table}) IS NOT NULL AS e`, tx);
  return !!r?.e;
}

// ------------------------------------------------------------------ writes

/** A column value for updateUser: jsonb values are wrapped, bytea as Buffer. */
export type ColVal = string | number | boolean | null | Buffer | { json: unknown };

/** Columns updateUser may set (the writable serializer fields plus password/avatar/flags). */
const UPDATABLE = new Set([
  "password", "username", "avatar", "email", "first_name", "last_name", "scan_directory", "transcode_videos",
  "nextcloud_server_address", "nextcloud_username", "nextcloud_app_password", "nextcloud_scan_directory",
  "confidence", "confidence_person", "semantic_search_topk", "favorite_min_rating", "save_metadata_to_disk",
  "save_face_tags_to_disk", "image_scale", "text_alignment", "header_size", "datetime_rules", "burst_detection_rules",
  "default_timezone", "public_sharing", "public_sharing_defaults", "min_cluster_size", "confidence_unknown_face",
  "min_samples", "cluster_selection_epsilon", "llm_settings", "skip_raw_files", "stack_raw_jpeg", "slideshow_interval",
  "duplicate_sensitivity", "duplicate_clear_existing", "is_active", "is_staff", "is_superuser",
]);

const FLOAT_COLS = new Set(["confidence", "confidence_person", "image_scale", "confidence_unknown_face", "cluster_selection_epsilon"]);

function colValue(col: string, v: ColVal): SQL {
  if (v !== null && typeof v === "object" && !Buffer.isBuffer(v)) return jsonbParam(v.json);
  if (typeof v === "number") return FLOAT_COLS.has(col) ? sql`${v}::float8` : sql`${v}::int`;
  return sql`${v}`;
}

/**
 * UPDATE api_user SET <cols> [, last_modified = now()] WHERE id. `bump`
 * mirrors Django's full save(); save(update_fields=..) callers pass false.
 */
export async function updateUser(userId: number, cols: [string, ColVal][], bump: boolean, tx: Db | Tx = db) {
  if (!cols.length && !bump) return;
  const sets = cols.map(([c, v]) => {
    if (!UPDATABLE.has(c)) throw new Error(`api_user.${c} is not updatable`);
    return sql`${sql.raw(c)} = ${colValue(c, v)}`;
  });
  if (bump) sets.push(sql`last_modified = now()`);
  await tx.execute(sql`UPDATE api_user SET ${sql.join(sets, sql`, `)} WHERE id = ${userId}`);
}

export interface NewUser {
  username: string;
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  isSuperuser: boolean;
  isStaff: boolean;
  scanDirectory: string;
}

const userDefaults = {
  datetime_rules: JSON.parse(USER_DATETIME_RULES),
  llm_settings: JSON.parse(USER_LLM_SETTINGS),
  burst_detection_rules: JSON.parse(USER_BURST_DETECTION_RULES),
  public_sharing_defaults: JSON.parse(USER_PUBLIC_SHARING_DEFAULTS),
};

/** settings.DEFAULT_FAVORITE_MIN_RATING */
const DEFAULT_FAVORITE_MIN_RATING = 4;

/**
 * Insert a user with every Django model default filled in; returns the id.
 * nextcloud_app_password gets a Django-decryptable encryption of "".
 */
export async function createUser(n: NewUser, tx: Db | Tx = db): Promise<number> {
  const r = await row<{ id: number }>(
    sql`INSERT INTO api_user (password, last_login, is_superuser, username, first_name, last_name,
        email, is_staff, is_active, date_joined, scan_directory, avatar, nextcloud_server_address,
        nextcloud_username, nextcloud_app_password, nextcloud_scan_directory, confidence,
        semantic_search_topk, favorite_min_rating, image_scale, save_metadata_to_disk,
        transcode_videos, datetime_rules, default_timezone, confidence_person, public_sharing,
        confidence_unknown_face, face_recognition_model, min_cluster_size,
        cluster_selection_epsilon, min_samples, llm_settings, text_alignment, header_size,
        skip_raw_files, slideshow_interval, duplicate_clear_existing, duplicate_sensitivity,
        burst_detection_rules, stack_raw_jpeg, public_sharing_defaults, save_face_tags_to_disk, last_modified)
      VALUES (${n.passwordHash}, NULL, ${n.isSuperuser}, ${n.username}, ${n.firstName}, ${n.lastName}, ${n.email},
        ${n.isStaff}, TRUE, now(), ${n.scanDirectory}, '', '', '', ${encryptStr("")}, '', 0.1, 0,
        ${DEFAULT_FAVORITE_MIN_RATING}, 1, 'OFF', FALSE, ${jsonbParam(userDefaults.datetime_rules)}, 'UTC', 0.9, FALSE,
        0.5, 'HOG', 0, 0.05, 1, ${jsonbParam(userDefaults.llm_settings)}, 'right', 'large', FALSE, 5, FALSE, 'normal',
        ${jsonbParam(userDefaults.burst_detection_rules)}, TRUE, ${jsonbParam(userDefaults.public_sharing_defaults)}, FALSE, now())
      RETURNING id`,
    tx,
  );
  return r!.id;
}

/**
 * SignupUserSerializer.create: one INSERT, or the takeover of an abandoned
 * sign-up row with the same username; admin when no superuser exists yet.
 */
export function signupUser(s: { username: string; email: string; firstName: string; lastName: string; passwordHash: string }) {
  return db.transaction(async (tx) => {
    const first = await isFirstTimeSetup(tx);
    const existing = await row<{ id: number }>(sql`SELECT id FROM api_user WHERE username = ${s.username}`, tx);
    if (existing) {
      await updateUser(
        existing.id,
        [
          ["email", s.email],
          ["first_name", s.firstName],
          ["last_name", s.lastName],
          ["password", s.passwordHash],
          ["is_staff", first],
          ["is_superuser", first],
        ],
        true,
        tx,
      );
      return existing.id;
    }
    return createUser({ ...s, isSuperuser: first, isStaff: first, scanDirectory: "" }, tx);
  });
}

/** UserSerializer.create (admin): create_user plus the further columns sent. */
export function adminCreateUser(n: NewUser, extra: [string, ColVal][]) {
  return db.transaction(async (tx) => {
    const id = await createUser(n, tx);
    if (extra.length) await updateUser(id, extra, false, tx);
    return id;
  });
}

/** auto_create_user_directory: save(update_fields=["scan_directory"]). */
export async function setScanDirectory(userId: number, dir: string) {
  await db.execute(sql`UPDATE api_user SET scan_directory = ${dir} WHERE id = ${userId}`);
}

/** ForeignKey(User, on_delete=SET(get_deleted_user)) columns. */
const REASSIGN_TO_DELETED: [string, string][] = [
  ["api_photo", "owner_id"],
  ["api_cluster", "owner_id"],
  ["api_albumdate", "owner_id"],
  ["api_albumthing", "owner_id"],
  ["api_albumauto", "owner_id"],
  ["api_albumplace", "owner_id"],
  ["api_albumuser", "owner_id"],
  ["api_longrunningjob", "started_by_id"],
  ["api_photostack", "owner_id"],
  ["api_metadataedit", "user_id"],
  ["api_stackreview", "reviewer_id"],
  ["api_duplicate", "owner_id"],
  ["api_tag", "owner_id"],
];

/** M2M through tables and CASCADE FKs removed with the user. */
const DELETE_WITH_USER: [string, string][] = [
  ["api_user_groups", "user_id"],
  ["api_user_user_permissions", "user_id"],
  ["api_photo_shared_to", "user_id"],
  ["api_albumdate_shared_to", "user_id"],
  ["api_albumthing_shared_to", "user_id"],
  ["api_albumauto_shared_to", "user_id"],
  ["api_albumplace_shared_to", "user_id"],
  ["api_albumuser_shared_to", "user_id"],
  ["api_deletionlog", "owner_id"],
  ["chunked_upload_chunkedupload", "user_id"],
];

/** get_deleted_user(): the inactive `deleted` sentinel, created if missing. */
async function deletedUserId(tx: Tx): Promise<number> {
  const found = await row<{ id: number; is_active: boolean }>(sql`SELECT id, is_active FROM api_user WHERE username = 'deleted'`, tx);
  let id = found?.id;
  let active = found?.is_active ?? true;
  if (id === undefined) {
    id = await createUser(
      { username: "deleted", email: "", passwordHash: "", firstName: "", lastName: "", isSuperuser: false, isStaff: false, scanDirectory: "" },
      tx,
    );
    active = true;
  }
  if (active) await updateUser(id, [["is_active", false]], true, tx);
  return id;
}

/**
 * Delete a user the way Django's collector does: reassign the
 * SET(get_deleted_user) FKs, null Person.cluster_owner, drop M2M/CASCADE rows
 * (allauth, admin log, simplejwt outstanding tokens when those tables exist),
 * then the user row. One transaction.
 */
export function deleteUser(userId: number) {
  return db.transaction(async (tx) => {
    const deleted = await deletedUserId(tx);
    const t = await row<Record<string, boolean>>(
      sql`SELECT to_regclass('public.account_emailaddress') IS NOT NULL AS email,
                 to_regclass('public.account_emailconfirmation') IS NOT NULL AS confirm,
                 to_regclass('public.socialaccount_socialaccount') IS NOT NULL AS social,
                 to_regclass('public.socialaccount_socialtoken') IS NOT NULL AS stoken,
                 to_regclass('public.django_admin_log') IS NOT NULL AS adminlog,
                 to_regclass('public.token_blacklist_outstandingtoken') IS NOT NULL AS outstanding`,
      tx,
    );
    const stmts: SQL[] = REASSIGN_TO_DELETED.map(
      ([table, col]) => sql`UPDATE ${sql.raw(table)} SET ${sql.raw(col)} = ${deleted} WHERE ${sql.raw(col)} = ${userId}`,
    );
    stmts.push(sql`UPDATE api_person SET cluster_owner_id = NULL WHERE cluster_owner_id = ${userId}`);
    for (const [table, col] of DELETE_WITH_USER) stmts.push(sql`DELETE FROM ${sql.raw(table)} WHERE ${sql.raw(col)} = ${userId}`);
    if (t?.email) {
      if (t.confirm)
        stmts.push(sql`DELETE FROM account_emailconfirmation WHERE email_address_id IN (SELECT id FROM account_emailaddress WHERE user_id = ${userId})`);
      stmts.push(sql`DELETE FROM account_emailaddress WHERE user_id = ${userId}`);
    }
    if (t?.social) {
      if (t.stoken)
        stmts.push(sql`DELETE FROM socialaccount_socialtoken WHERE account_id IN (SELECT id FROM socialaccount_socialaccount WHERE user_id = ${userId})`);
      stmts.push(sql`DELETE FROM socialaccount_socialaccount WHERE user_id = ${userId}`);
    }
    if (t?.adminlog) stmts.push(sql`DELETE FROM django_admin_log WHERE user_id = ${userId}`);
    if (t?.outstanding) stmts.push(sql`UPDATE token_blacklist_outstandingtoken SET user_id = NULL WHERE user_id = ${userId}`);
    stmts.push(sql`DELETE FROM api_user WHERE id = ${userId}`);
    for (const s of stmts) await tx.execute(s);
  });
}

// ------------------------------------------------------------ email config

export interface EmailConfigRow {
  provider: string;
  from_email: string;
  host: string;
  port: number;
  use_tls: boolean;
  use_ssl: boolean;
  username: string;
  secret: Uint8Array;
}

/** The api_emailconfig singleton (pk=1), if it was ever saved. */
export function emailConfigRow(): Promise<EmailConfigRow | undefined> {
  return row<EmailConfigRow>(sql`SELECT provider, from_email, host, port, use_tls, use_ssl, username, secret FROM api_emailconfig WHERE id = 1`);
}

/** EmailConfig.save(): upsert pk=1 (secret already encrypted). */
export async function saveEmailConfig(c: Omit<EmailConfigRow, "secret"> & { secret: Buffer }) {
  await db.execute(sql`INSERT INTO api_emailconfig (id, provider, from_email, host, port, use_tls, use_ssl, username, secret)
    VALUES (1, ${c.provider}, ${c.from_email}, ${c.host}, ${c.port}::int, ${c.use_tls}, ${c.use_ssl}, ${c.username}, ${c.secret})
    ON CONFLICT (id) DO UPDATE SET provider = EXCLUDED.provider, from_email = EXCLUDED.from_email, host = EXCLUDED.host,
      port = EXCLUDED.port, use_tls = EXCLUDED.use_tls, use_ssl = EXCLUDED.use_ssl, username = EXCLUDED.username,
      secret = EXCLUDED.secret`);
}

// ---------------------------------------------------------------- throttle

/** Hits in the sliding window of a rate limit, newest first (epoch ms). */
export async function throttleHitsSince(scope: string, ident: string, since: Date): Promise<number[]> {
  const r = await rows<{ ms: number }>(
    sql`SELECT (extract(epoch FROM hit_at) * 1000)::float8 AS ms FROM rate_limit_hit
        WHERE scope = ${scope} AND ident = ${ident} AND hit_at > ${since.toISOString()}::timestamptz ORDER BY hit_at DESC`,
  );
  return r.map((x) => Number(x.ms));
}

/** Record one hit and forget every hit of `scope` older than the window (all idents). */
export function recordThrottleHit(scope: string, ident: string, at: Date, keepAfter: Date) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM rate_limit_hit WHERE scope = ${scope} AND hit_at <= ${keepAfter.toISOString()}::timestamptz`);
    await tx.execute(sql`INSERT INTO rate_limit_hit (scope, ident, hit_at) VALUES (${scope}, ${ident}, ${at.toISOString()}::timestamptz)`);
  });
}

/** The encrypted nextcloud_app_password (not part of UserRow). */
export async function nextcloudAppPassword(userId: number): Promise<Uint8Array | null> {
  const r = await row<{ p: Uint8Array }>(sql`SELECT nextcloud_app_password AS p FROM api_user WHERE id = ${userId}`);
  return r?.p ?? null;
}

/** UPDATE api_user SET password, last_modified (set_password + save). */
export async function setPassword(userId: number, hash: string) {
  await db.execute(sql`UPDATE api_user SET password = ${hash}, last_modified = now() WHERE id = ${userId}`);
}

/** Owners of CLIP embeddings another semantic-search model produced. */
export async function mismatchedClipOwners(model: string): Promise<number[]> {
  const r = await rows<{ owner_id: number }>(
    sql`SELECT DISTINCT p.owner_id FROM api_photo p
        WHERE p.clip_embeddings IS NOT NULL AND coalesce(p.clip_embeddings_model, 'clip_vit_b32') <> ${model} ORDER BY p.owner_id`,
  );
  return r.map((x) => x.owner_id);
}

/** Whether a clip.embed job for this user is already waiting. */
export async function clipEmbedQueued(userId: number): Promise<boolean> {
  const r = await row<{ w: boolean }>(
    sql`SELECT EXISTS (SELECT 1 FROM job_queue WHERE status = 'queued' AND kind = 'clip.embed' AND payload->'user_id' = to_jsonb(${userId}::int)) AS w`,
  );
  return !!r?.w;
}

