// UserViewSet, ManageUserViewSet, DeleteUserViewSet and IsFirstTimeSetupView
// (api/views/user.py, api/serializers/user.py). Port of
// lp_api::users_settings::user.
import { config } from "~/lib/config";
import { ApiError } from "~/lib/errors";
import { json } from "~/lib/http";
import { hashPassword } from "~/lib/password";
import type { QueryMap } from "~/lib/query";
import { siteSettings } from "~/lib/settings";
import type { User } from "~/lib/users";
import { storeAvatar, validateAvatar } from "./avatar";
import { encryptStr } from "./crypto";
import {
  adminCreateUser,
  deleteUser,
  isFirstTimeSetup,
  listUsers,
  plainUser,
  plainUserByUsername,
  signupUser,
  updateUser,
  usernameTakenByOther,
  userWithStats,
  type ColVal,
  type UserRow,
  type UserScope,
} from "./db";
import {
  charK,
  DUPLICATE_SENSITIVITY,
  Errors,
  HEADER_SIZE,
  K,
  parse,
  SAVE_METADATA,
  TEXT_ALIGNMENT,
  type Kind,
  type Parsed,
} from "./fields";
import { readInput, type Input, type UploadedFile } from "./input";
import { queueClipEmbeddings } from "./ml_triggers";
import { validateServerAddress } from "./nextcloud";
import { autoCreateUserDirectory, normalizeScanDirectory } from "./scan_dir";
import { fullUser, manageUser, publicUser, requestOrigin, signupUserOut } from "./serialize";

const PAGE_SIZE = 20_000;
const PASSWORD = charK(128, 0, false);

/** Writable UserSerializer fields, in Meta.fields order. */
const USER_FIELDS: [string, Kind][] = [
  ["username", K.username],
  ["email", K.email],
  ["scan_directory", charK(512)],
  ["confidence", K.float],
  ["confidence_person", K.float],
  ["transcode_videos", K.bool],
  ["semantic_search_topk", K.int],
  ["first_name", charK(150)],
  ["last_name", charK(150)],
  ["date_joined", K.datetime(false)],
  ["password", PASSWORD],
  ["avatar", K.json], // ImageField, validated separately
  ["is_superuser", K.bool],
  ["nextcloud_server_address", charK(200)],
  ["nextcloud_username", charK(64)],
  ["nextcloud_app_password", charK(64)],
  ["nextcloud_scan_directory", charK(512)],
  ["favorite_min_rating", K.int],
  ["image_scale", K.float],
  ["text_alignment", K.choice(TEXT_ALIGNMENT)],
  ["header_size", K.choice(HEADER_SIZE)],
  ["save_metadata_to_disk", K.choice(SAVE_METADATA)],
  ["save_face_tags_to_disk", K.bool],
  ["datetime_rules", K.json],
  ["burst_detection_rules", K.json],
  ["llm_settings", K.json],
  ["default_timezone", K.timezone],
  ["public_sharing", K.bool],
  ["public_sharing_defaults", K.json],
  ["min_cluster_size", K.int],
  ["confidence_unknown_face", K.float],
  ["min_samples", K.int],
  ["cluster_selection_epsilon", K.float],
  ["skip_raw_files", K.bool],
  ["stack_raw_jpeg", K.bool],
  ["slideshow_interval", K.int],
  ["duplicate_sensitivity", K.choice(DUPLICATE_SENSITIVITY)],
  ["duplicate_clear_existing", K.bool],
];

/** USER_UPDATE_FIELDS: what UserSerializer.update applies, in order. */
const USER_UPDATE_FIELDS = [
  "avatar", "email", "first_name", "last_name", "transcode_videos", "nextcloud_server_address", "nextcloud_username",
  "nextcloud_app_password", "nextcloud_scan_directory", "confidence", "confidence_person", "semantic_search_topk",
  "favorite_min_rating", "save_metadata_to_disk", "save_face_tags_to_disk", "image_scale", "text_alignment",
  "header_size", "datetime_rules", "burst_detection_rules", "default_timezone", "public_sharing", "min_cluster_size",
  "confidence_unknown_face", "min_samples", "cluster_selection_epsilon", "llm_settings", "skip_raw_files",
  "stack_raw_jpeg", "slideshow_interval", "duplicate_sensitivity", "duplicate_clear_existing",
];

/** Writable ManageUserSerializer fields, in Meta.fields order. */
const MANAGE_FIELDS: [string, Kind][] = [
  ["username", K.username],
  ["scan_directory", charK(512)],
  ["skip_raw_files", K.bool],
  ["stack_raw_jpeg", K.bool],
  ["confidence", K.float],
  ["semantic_search_topk", K.int],
  ["last_login", K.datetime(true)],
  ["date_joined", K.datetime(false)],
  ["favorite_min_rating", K.int],
  ["image_scale", K.float],
  ["save_metadata_to_disk", K.choice(SAVE_METADATA)],
  ["email", K.email],
  ["first_name", charK(150)],
  ["last_name", charK(150)],
  ["password", PASSWORD],
];

/** A plain ExifTool tag (lp_exif::is_safe_tag): it becomes a `-<tag>` argument. */
const isSafeTag = (t: string) => t.length <= 128 && /^[A-Za-z0-9_][A-Za-z0-9_\-:*?#]*$/.test(t);

/** Python repr() of a str. */
function strRepr(s: string): string {
  const q = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = q;
  for (const c of s) {
    const n = c.codePointAt(0)!;
    if (c === "\\") out += "\\\\";
    else if (c === "\n") out += "\\n";
    else if (c === "\r") out += "\\r";
    else if (c === "\t") out += "\\t";
    else if (c === q) out += "\\" + c;
    else if (n < 0x20 || n === 0x7f) out += "\\x" + n.toString(16).padStart(2, "0");
    else out += c;
  }
  return out + q;
}

/**
 * validate_rule_exif_tag_names (Django #2123): the ExifTool tag names in
 * datetime_rules / burst_detection_rules (condition_exif before the first
 * `//`, a datetime rule's exif_tag) must be plain tags. The value may be the
 * list or the JSON string encoding it; anything else is left alone.
 */
export function validateRuleTags(field: string, value: unknown): string | null {
  let rules = value;
  if (typeof value === "string") {
    try {
      rules = JSON.parse(value);
    } catch {
      return `${field} is not valid JSON.`;
    }
  }
  if (!Array.isArray(rules)) return null;
  for (const rule of rules) {
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) continue;
    const names: string[] = [];
    const c = (rule as Record<string, unknown>).condition_exif;
    if (typeof c === "string" && c) names.push(c.split("//")[0]);
    const t = (rule as Record<string, unknown>).exif_tag;
    if (typeof t === "string" && t) names.push(t);
    const bad = names.find((n) => !isSafeTag(n));
    if (bad !== undefined) {
      return `${field} contains an invalid ExifTool tag name: ${strRepr(bad)}. A tag name may only contain letters, digits and the characters _ : * ? # -, and must not start with '-' or ':'.`;
    }
  }
  return null;
}

interface Validated {
  values: Map<string, Parsed>;
  /** undefined = not sent, null = clear, file = upload. */
  avatar: UploadedFile | null | undefined;
}

const str = (v: Validated, k: string): string | undefined => {
  const x = v.values.get(k);
  return typeof x === "string" ? x : undefined;
};

/** DRF Serializer.is_valid() over `specs` (`instance` = the user being updated). */
async function validate(input: Input, specs: [string, Kind][], required: string[], instance: UserRow | null): Promise<Validated> {
  const errors = new Errors();
  const out: Validated = { values: new Map(), avatar: undefined };
  for (const [name, kind] of specs) {
    const raw = input.fields.get(name);
    if (!raw) {
      if (required.includes(name)) errors.add(name, ["This field is required."]);
      continue;
    }
    if (name === "avatar") {
      const a = await validateAvatar(raw);
      if ("error" in a) errors.add(name, [a.error]);
      else out.avatar = a.file;
      continue;
    }
    let value: unknown = "value" in raw ? raw.value : "";
    if (kind.t === "json" && input.html && typeof value === "string") {
      try {
        value = JSON.parse(value);
      } catch {
        errors.add(name, ["Value must be valid JSON."]);
        continue;
      }
    }
    const r = parse(kind, value);
    if ("err" in r) {
      errors.add(name, r.err);
      continue;
    }
    const parsed = r.ok;
    if (name === "username" && (await usernameTakenByOther(parsed as string, instance?.id ?? null))) {
      errors.add(name, ["A user with that username already exists."]);
      continue;
    }
    if (name === "nextcloud_server_address") {
      const addr = (parsed as string).trim();
      const unchanged = instance !== null && instance.nextcloud_server_address === addr;
      if (addr && !unchanged) {
        const bad = await validateServerAddress(addr);
        if (bad) {
          errors.add(name, [bad]);
          continue;
        }
      }
    }
    if ((name === "datetime_rules" || name === "burst_detection_rules") && parsed && typeof parsed === "object" && "json" in parsed) {
      const bad = validateRuleTags(name, parsed.json);
      if (bad) {
        errors.add(name, [bad]);
        continue;
      }
    }
    out.values.set(name, parsed);
  }
  errors.throwIfAny();
  return out;
}

/** A validated value as a column value (datetimes are validated only, never written). */
function col(p: Parsed): ColVal | undefined {
  if (p === null || (typeof p === "object" && "dt" in p)) return undefined;
  return p;
}

/** The path id: a 404 like get_object_or_404 for anything not an int. */
function parseId(raw: string | undefined): number {
  const t = (raw ?? "").trim();
  if (!/^[+-]?\d+$/.test(t)) throw ApiError.notFound();
  const n = Number(t);
  if (n > 2147483647 || n < -2147483648) throw ApiError.notFound();
  return n;
}

const noUser = () => ApiError.notFound("No User matches the given query.");
const scopeFor = (viewer: User | null): UserScope => (viewer ? "active" : "public");

// ------------------------------------------------------------------ reads

/** GET /api/user/{id}/ */
export async function retrieveUser(viewer: User | null, rawId: string | undefined, req: Request) {
  const id = parseId(rawId);
  const target = await userWithStats(id, scopeFor(viewer));
  if (!target) throw noUser();
  const full = viewer !== null && (viewer.isStaff || viewer.isSuperuser || viewer.id === id);
  return full ? fullUser(target, requestOrigin(req)) : publicUser(target);
}

/** DRF _positive_int */
function positiveInt(raw: string | undefined, strict: boolean): number | undefined {
  const t = raw?.trim();
  if (t === undefined || !/^[+-]?\d+$/.test(t)) return undefined;
  const n = Number(t);
  if (n < 0 || (strict && n === 0)) return undefined;
  return n;
}

/** form_urlencoded byte serialization (alphanumerics and *-._ kept, space as +). */
const formEncode = (s: string) =>
  encodeURIComponent(s)
    .replace(/%20/g, "+")
    .replace(/[!'()~]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

/** DRF replace_query_param / remove_query_param on the request URL (keys sorted). */
function withParams(origin: string, url: URL, set: [string, number][], remove: string[]): string {
  const merged = new Map<string, string[]>();
  for (const [k, v] of url.searchParams) merged.set(k, [...(merged.get(k) ?? []), v]);
  for (const [k, v] of set) merged.set(k, [String(v)]);
  for (const k of remove) merged.delete(k);
  const keys = [...merged.keys()].sort();
  const q = keys.flatMap((k) => merged.get(k)!.map((v) => `${formEncode(k)}=${formEncode(v)}`)).join("&");
  const path = url.pathname.replace(/\/+$/, "") + "/";
  return q ? `${origin}${path}?${q}` : `${origin}${path}`;
}

/** LimitOffsetPagination get_next_link / get_previous_link. */
function pageLinks(origin: string, url: URL, limit: number, offset: number, count: number) {
  const next = offset + limit < count ? withParams(origin, url, [["limit", limit], ["offset", offset + limit]], []) : null;
  let previous: string | null = null;
  if (offset > 0) {
    previous =
      offset - limit <= 0
        ? withParams(origin, url, [["limit", limit]], ["offset"])
        : withParams(origin, url, [["limit", limit], ["offset", offset - limit]], []);
  }
  return { next, previous };
}

async function page(scope: UserScope, query: QueryMap, stats: "full" | "count") {
  const limit = positiveInt(query.get("limit"), true) ?? PAGE_SIZE;
  const offset = positiveInt(query.get("offset"), false) ?? 0;
  const { count, users } = await listUsers(scope, limit, offset, stats);
  return { limit, offset, count, users: count === 0 || offset > count ? [] : users };
}

/** GET /api/user/ (LimitOffsetPagination, default limit 20000). */
export async function listUsersView(viewer: User | null, req: Request, url: URL, query: QueryMap) {
  const p = await page(scopeFor(viewer), query, "full");
  const full = viewer !== null && (viewer.isStaff || viewer.isSuperuser);
  const origin = requestOrigin(req);
  return {
    count: p.count,
    ...pageLinks(origin, url, p.limit, p.offset, p.count),
    results: p.users.map((u) => (full ? fullUser(u, origin) : publicUser(u))),
  };
}

/** GET /api/manage/user/ (admin; inactive users included). */
export async function manageList(req: Request, url: URL, query: QueryMap) {
  const p = await page("all", query, "count");
  return {
    count: p.count,
    ...pageLinks(requestOrigin(req), url, p.limit, p.offset, p.count),
    results: p.users.map(manageUser),
  };
}

/** GET /api/manage/user/{id}/ */
export async function manageRetrieve(rawId: string | undefined) {
  const u = await userWithStats(parseId(rawId), "all", "count");
  if (!u) throw noUser();
  return manageUser(u);
}

/** GET /api/firsttimesetup/ */
export async function firstTimeSetup() {
  return { isFirstTimeSetup: await isFirstTimeSetup() };
}

// ----------------------------------------------------------------- create

/** identify_hasher fails: not one of PASSWORD_HASHERS. */
function unusableHash(encoded: string): boolean {
  let algo: string;
  if ((encoded.length === 32 && !encoded.includes("$")) || (encoded.length === 37 && encoded.startsWith("md5$$"))) algo = "unsalted_md5";
  else if (encoded.length === 46 && encoded.startsWith("sha1$$")) algo = "unsalted_sha1";
  else algo = encoded.split("$")[0];
  return !["argon2", "pbkdf2_sha256", "pbkdf2_sha1"].includes(algo);
}

/** is_abandoned_signup: a never-used, non-admin row while setup is still pending. */
async function isAbandonedSignup(u: UserRow): Promise<boolean> {
  if (u.is_superuser || u.last_login !== null) return false;
  if (!(await isFirstTimeSetup())) return false;
  return unusableHash(u.password);
}

/** POST /api/user/: first-time setup, self-registration, or an admin. */
export async function createUserView(viewer: User | null, req: Request) {
  const isAdmin = viewer?.isStaff ?? false;
  if (!isAdmin && !(await siteSettings()).ALLOW_REGISTRATION && !(await isFirstTimeSetup())) {
    throw viewer ? ApiError.permissionDenied() : ApiError.notAuthenticated();
  }
  const input = await readInput(req);
  return viewer?.isSuperuser ? adminCreate(input, req) : signup(input);
}

async function signup(input: Input) {
  const specs: [string, Kind][] = [
    ["username", K.username],
    ["password", charK(128, 3, false)],
    ["email", K.email],
    ["first_name", charK(150)],
    ["last_name", charK(150)],
    ["is_superuser", K.bool],
  ];
  const required = ["username", "password", "email", "first_name", "last_name"];
  // Username uniqueness is validate_username: abandoned sign-ups may be taken over.
  const errors = new Errors();
  const values = new Map<string, Parsed>();
  for (const [name, kind] of specs) {
    const raw = input.fields.get(name);
    if (!raw) {
      if (required.includes(name)) errors.add(name, ["This field is required."]);
      continue;
    }
    const r = parse(kind, "value" in raw ? raw.value : "");
    if ("err" in r) {
      errors.add(name, r.err);
      continue;
    }
    if (name === "username") {
      const existing = await plainUserByUsername(r.ok as string);
      if (existing && !(await isAbandonedSignup(existing))) {
        errors.add(name, ["A user with that username already exists."]);
        continue;
      }
    }
    values.set(name, r.ok);
  }
  errors.throwIfAny();
  const s = (k: string) => (values.get(k) as string | undefined) ?? "";
  const id = await signupUser({
    username: s("username"),
    email: s("email"),
    firstName: s("first_name"),
    lastName: s("last_name"),
    passwordHash: await hashPassword(s("password")),
  });
  const user = await plainUser(id);
  if (!user) throw ApiError.notFound();
  await autoCreateUserDirectory(user, false);
  return json(signupUserOut(user), 201);
}

/** BaseUserManager.normalize_email: lower-case the domain part. */
function normalizeEmail(email: string): string {
  const t = email.trim();
  const at = t.lastIndexOf("@");
  return at < 0 ? email : `${t.slice(0, at)}@${t.slice(at + 1).toLowerCase()}`;
}

const NOT_EXTRA = new Set(["username", "email", "password", "first_name", "last_name", "scan_directory", "is_superuser", "date_joined"]);

async function adminCreate(input: Input, req: Request) {
  const v = await validate(input, USER_FIELDS, ["username", "password"], null);
  let scanDirectory = "";
  const dir = str(v, "scan_directory");
  if (dir && dir !== "initial") scanDirectory = (await normalizeScanDirectory(dir, null)) ?? "";
  const superuser = v.values.get("is_superuser") === true;
  const extra: [string, ColVal][] = [];
  for (const [name, p] of v.values) {
    if (NOT_EXTRA.has(name)) continue;
    const value = name === "nextcloud_app_password" ? encryptStr((p as string) ?? "") : col(p);
    if (value !== undefined) extra.push([name, value]);
  }
  if (v.avatar) extra.push(["avatar", await storeAvatar(v.avatar)]);
  const id = await adminCreateUser(
    {
      username: (str(v, "username") ?? "").toLowerCase(),
      email: normalizeEmail(str(v, "email") ?? ""),
      passwordHash: await hashPassword(str(v, "password") ?? ""),
      firstName: str(v, "first_name") ?? "",
      lastName: str(v, "last_name") ?? "",
      isSuperuser: superuser,
      isStaff: superuser,
      scanDirectory,
    },
    extra,
  );
  const created = await plainUser(id);
  if (!created) throw ApiError.notFound();
  await autoCreateUserDirectory(created, true);
  const user = await userWithStats(id, "all");
  if (!user) throw ApiError.notFound();
  return json(fullUser(user, requestOrigin(req)), 201);
}

// ----------------------------------------------------------------- update

/** PATCH /api/user/{id}/ (IsAdminOrSelf; JSON profile or multipart avatar). */
export async function updateUserView(viewer: User | null, rawId: string | undefined, req: Request) {
  const id = parseId(rawId);
  const target = await plainUser(id);
  const visible = target && target.is_active && (viewer !== null || target.public_sharing);
  if (!target || !visible) throw noUser();
  if (!viewer) throw ApiError.notAuthenticated();
  if (!viewer.isStaff && viewer.id !== target.id) throw ApiError.permissionDenied();
  const input = await readInput(req);
  const v = await validate(input, USER_FIELDS, [], target);

  const cols: [string, ColVal][] = [];
  let appliedAny = false;
  let queueClip = false;
  for (const field of USER_UPDATE_FIELDS) {
    if (field === "avatar") {
      if (v.avatar === undefined) continue;
      cols.push(["avatar", v.avatar === null ? null : await storeAvatar(v.avatar)]);
      appliedAny = true;
      continue;
    }
    if (!v.values.has(field)) continue;
    const p = v.values.get(field)!;
    appliedAny = true;
    if (field === "semantic_search_topk" && typeof p === "number") queueClip = target.semantic_search_topk === 0 && p > 0;
    const value = field === "nextcloud_app_password" ? encryptStr((p as string) ?? "") : col(p);
    if (value !== undefined) cols.push([field, value]);
  }
  if (appliedAny) {
    const pw = str(v, "password");
    if (pw && !config.demoSite) cols.push(["password", await hashPassword(pw)]);
    // Django saves an instance loaded with .only(...), writing only the loaded
    // and assigned fields: last_modified is never bumped here.
    await updateUser(target.id, cols, false);
  }
  if (queueClip) await queueClipEmbeddings(target.id);
  const user = await userWithStats(target.id, "all");
  if (!user) throw ApiError.notFound();
  return fullUser(user, requestOrigin(req));
}

/** PATCH /api/manage/user/{id}/ (admin). */
export async function manageUpdate(rawId: string | undefined, req: Request) {
  const id = parseId(rawId);
  const target = await plainUser(id);
  if (!target) throw noUser();
  const input = await readInput(req);
  const v = await validate(input, MANAGE_FIELDS, [], target);
  const cols: [string, ColVal][] = [];
  const pw = str(v, "password");
  const newPassword = pw && !config.demoSite ? pw : null;
  const dir = str(v, "scan_directory");
  if (dir !== undefined) {
    const abs = await normalizeScanDirectory(dir, target);
    if (abs !== null) {
      console.info(`Updated scan directory for user ${abs}`);
      cols.push(["scan_directory", abs]);
    }
  }
  for (const f of ["skip_raw_files", "stack_raw_jpeg"]) {
    const b = v.values.get(f);
    if (typeof b === "boolean") cols.push([f, b]);
  }
  for (const f of ["username", "email", "first_name", "last_name"]) {
    const s = str(v, f);
    if (s !== undefined) cols.push([f, s]);
  }
  if (newPassword) cols.push(["password", await hashPassword(newPassword)]);
  await updateUser(target.id, cols, true);
  const user = await userWithStats(target.id, "all", "count");
  if (!user) throw ApiError.notFound();
  return manageUser(user);
}

/** DELETE /api/delete/user/{id}/ (superuser; never another superuser). */
export async function destroyUser(admin: User, rawId: string | undefined) {
  if (!admin.isSuperuser) throw ApiError.statusOnly(401);
  const target = await plainUser(parseId(rawId));
  if (!target) throw noUser();
  if (target.is_superuser) throw ApiError.statusOnly(400);
  await deleteUser(target.id);
  return new Response(null, { status: 204 });
}
