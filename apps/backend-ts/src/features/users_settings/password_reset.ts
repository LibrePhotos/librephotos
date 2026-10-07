// POST /api/auth/password/reset/ and /confirm/ (api/views/password_reset.py).
// Port of lp_api::users_settings::password_reset.
//
// Tokens are Django's PasswordResetTokenGenerator format (<ts36>-<hmac>,
// salted HMAC-SHA256 over pk, password hash, last login, timestamp, email),
// so links issued by any of the three backends work on all of them. The
// request endpoint is rate limited per client like DRF's
// ScopedRateThrottle("password_reset"); the window lives in the database
// (rate_limit_hit) so every process shares it.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { ApiError } from "~/lib/errors";
import { json, jsonBody } from "~/lib/http";
import { hashPassword } from "~/lib/password";
import { pyTruthy } from "~/lib/query";
import { config } from "~/lib/config";
import type { User } from "~/lib/users";
import { COMMON_PASSWORDS } from "./common_passwords";
import { plainUser, recordThrottleHit, setPassword, throttleHitsSince, userByEmailIexact, type UserRow } from "./db";
import { sendingConfig, sendMail } from "./email";
import { requestOrigin } from "./serialize";

const KEY_SALT = "django.contrib.auth.tokens.PasswordResetTokenGenerator";
/** settings.PASSWORD_RESET_TIMEOUT (Django default: 3 days). */
const RESET_TIMEOUT_SECS = 259_200;
const THROTTLE_SCOPE = "password_reset";
const EPOCH_2001 = Date.UTC(2001, 0, 1) / 1000;

// ------------------------------------------------------------------ tokens

/** PasswordResetTokenGenerator._now(): seconds since 2001-01-01 (process TZ is UTC). */
const numSecondsNow = () => Math.floor(Date.now() / 1000 - EPOCH_2001);

type TokenUser = Pick<UserRow, "id" | "password" | "last_login" | "email">;

function hashValue(u: TokenUser, ts: number): string {
  // user.last_login.replace(microsecond=0, tzinfo=None), as str().
  const login = u.last_login ? u.last_login.slice(0, 19).replace("T", " ") : "";
  return `${u.id}${u.password}${login}${ts}${u.email}`;
}

function makeTokenAt(u: TokenUser, ts: number): string {
  const key = createHash("sha256").update(KEY_SALT + config.secretKey).digest();
  const hex = createHmac("sha256", key).update(hashValue(u, ts)).digest("hex");
  let short = "";
  for (let i = 0; i < hex.length; i += 2) short += hex[i];
  return `${ts.toString(36)}-${short}`;
}

export const makeToken = (u: TokenUser) => makeTokenAt(u, numSecondsNow());

export function checkToken(u: TokenUser, token: string): boolean {
  const parts = token.split("-");
  if (parts.length !== 2) return false;
  const ts36 = parts[0];
  if (!ts36 || ts36.length > 13 || !/^\+?[0-9a-zA-Z]+$/.test(ts36)) return false;
  const ts = parseInt(ts36.replace(/^\+/, ""), 36);
  if (!Number.isSafeInteger(ts)) return false;
  const expected = Buffer.from(makeTokenAt(u, ts));
  const got = Buffer.from(token);
  return expected.length === got.length && timingSafeEqual(expected, got) && numSecondsNow() - ts <= RESET_TIMEOUT_SECS;
}

/** urlsafe_base64_encode(force_bytes(pk)) */
export const encodeUid = (pk: number) => Buffer.from(String(pk)).toString("base64url");

function decodeUid(uid: string): number | null {
  const s = uid.replace(/=+$/, "");
  if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) return null;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(s, "base64url"));
  } catch {
    return null;
  }
  const t = text.trim();
  if (!/^[+-]?\d+$/.test(t)) return null;
  const n = Number(t);
  return n <= 2147483647 && n >= -2147483648 ? n : null;
}

// -------------------------------------------------------------- validators

let common: Set<string> | null = null;
const commonPasswords = () => (common ??= new Set(COMMON_PASSWORDS.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)));

/** SequenceMatcher(a, b).quick_ratio() */
function quickRatio(a: string, b: string): number {
  const ca = [...a];
  const cb = [...b];
  if (ca.length + cb.length === 0) return 1;
  const avail = new Map<string, number>();
  for (const c of cb) avail.set(c, (avail.get(c) ?? 0) + 1);
  let matches = 0;
  for (const c of ca) {
    const n = avail.get(c) ?? 0;
    if (n > 0) matches++;
    avail.set(c, n - 1);
  }
  return (2 * matches) / (ca.length + cb.length);
}

/** AUTH_PASSWORD_VALIDATORS: similarity, minimum length 8, common, numeric. */
export function validatePassword(password: string, u: Pick<UserRow, "username" | "first_name" | "last_name" | "email">): string[] {
  const errors: string[] = [];
  const pw = password.toLowerCase();
  const pwLen = [...pw].length;
  outer: for (const [value, verbose] of [
    [u.username, "username"],
    [u.first_name, "first name"],
    [u.last_name, "last name"],
    [u.email, "email address"],
  ] as const) {
    if (!value) continue;
    const lower = value.toLowerCase();
    for (const part of [...lower.split(/[^\p{L}\p{N}_]+/u), lower]) {
      const vlen = [...part].length;
      if (pwLen >= 10 * vlen && vlen < (0.7 / 2) * pwLen) continue;
      if (quickRatio(pw, part) >= 0.7) {
        errors.push(`The password is too similar to the ${verbose}.`);
        break outer;
      }
    }
  }
  if ([...password].length < 8) errors.push("This password is too short. It must contain at least 8 characters.");
  if (commonPasswords().has(pw.trim())) errors.push("This password is too common.");
  if (password && /^\p{N}+$/u.test(password)) errors.push("This password is entirely numeric.");
  return errors;
}

// ---------------------------------------------------------------- throttle

/** PASSWORD_RESET_THROTTLE_RATE ("5/hour"): [requests, window seconds]. */
function throttleRate(): [number, number] | null {
  const raw = process.env.PASSWORD_RESET_THROTTLE_RATE ?? "5/hour";
  const i = raw.indexOf("/");
  if (i < 0) return null;
  const num = Number(raw.slice(0, i).trim());
  const unit = raw.slice(i + 1).trim()[0];
  const secs = ({ s: 1, m: 60, h: 3600, d: 86400 } as Record<string, number>)[unit ?? ""];
  if (!Number.isInteger(num) || num < 0 || !secs) return null;
  return [num, secs];
}

/** DRF get_ident: X-Forwarded-For without spaces, else X-Real-IP, else the peer. */
function clientIdent(req: Request): string {
  const xff = (req.headers.get("x-forwarded-for") ?? "").replace(/\s+/g, "");
  if (xff) return xff;
  const real = (req.headers.get("x-real-ip") ?? "").trim();
  if (real) return real;
  // The peer address (REMOTE_ADDR) is not visible to a Start route.
  return "unknown";
}

async function throttle(ident: string) {
  const rate = throttleRate();
  if (!rate) return;
  const [num, secs] = rate;
  const now = new Date();
  const windowStart = new Date(now.getTime() - secs * 1000);
  const history = await throttleHitsSince(THROTTLE_SCOPE, ident, windowStart);
  if (history.length >= num) {
    const oldest = history[history.length - 1] ?? now.getTime();
    const remaining = secs - (now.getTime() - oldest) / 1000;
    const available = num - history.length + 1;
    const wait = available <= 0 ? null : Math.max(0, Math.ceil(remaining / available));
    let msg = "Request was throttled.";
    if (wait !== null) msg += ` Expected available in ${wait} ${wait === 1 ? "second" : "seconds"}.`;
    const err = ApiError.of(429, "detail", msg);
    if (wait !== null) err.withHeader("Retry-After", String(wait));
    throw err;
  }
  await recordThrottleHit(THROTTLE_SCOPE, ident, now, windowStart);
}

// ------------------------------------------------------------------- views

/**
 * django.http.request.split_domain_port: the domain of a well-formed Host
 * header, null otherwise (keeps e.g. `localhost:80@evil.example` out of the
 * emailed link).
 */
function splitDomain(host: string): string | null {
  const m = /^([a-z0-9.-]+|\[[a-f0-9]*:[a-f0-9.:]+\])(:[0-9]+)?$/.exec(host.toLowerCase());
  return m ? m[1].replace(/\.+$/, "") : null;
}

/**
 * trusted_public_base_url: FRONTEND_BASE_URL, else the request origin only
 * when its host is one Django's concrete ALLOWED_HOSTS would accept or an
 * entry of CSRF_TRUSTED_ORIGINS.
 */
function trustedBaseUrl(req: Request): string {
  const configured = (process.env.FRONTEND_BASE_URL ?? "").replace(/\/+$/, "");
  if (configured) return configured;
  const host = req.headers.get("host");
  if (!host) return "";
  const backend = (process.env.BACKEND_HOST ?? "backend").toLowerCase();
  const domain = splitDomain(host);
  if (domain !== null && (domain === "localhost" || domain === backend)) return requestOrigin(req);
  const origins = ["http://localhost:3000", ...(process.env.CSRF_TRUSTED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean)];
  for (const origin of origins) {
    const i = origin.indexOf("://");
    const netloc = (i >= 0 ? origin.slice(i + 3) : origin).split("/")[0];
    if (netloc === host && !origin.includes("*")) return origin.replace(/\/+$/, "");
  }
  return "";
}

async function sendResetEmail(user: UserRow, base: string) {
  if (!base) {
    console.error(
      `Password reset for user ${user.id} not sent: set FRONTEND_BASE_URL to the address users browse to, so the emailed link can be trusted.`,
    );
    return;
  }
  const cfg = await sendingConfig();
  if (!cfg) {
    console.warn("Outgoing email is not configured; 1 message(s) not sent.");
    return;
  }
  const link = `${base}/password-reset/confirm/${encodeUid(user.id)}/${makeToken(user)}`;
  const body = `Hello ${user.username},\n\nWe received a request to reset the password for your LibrePhotos account. Open the link below to choose a new password:\n\n${link}\n\nIf you did not request this, you can safely ignore this email; your password will not change.\n`;
  await sendMail(cfg, "Reset your LibrePhotos password", body, user.email);
}

export async function requestReset(viewer: User | null, req: Request) {
  let ident = viewer ? String(viewer.id) : clientIdent(req);
  // rate_limit_hit.ident is varchar(255); X-Forwarded-For can be longer.
  ident = [...ident].slice(0, 255).join("");
  await throttle(ident);
  const data = await jsonBody<Record<string, unknown>>(req);
  const email = typeof data?.email === "string" ? data.email.trim() : "";
  if (email) {
    const user = await userByEmailIexact(email);
    if (user && user.email) {
      // In the background: the answer must not reveal (by its timing) whether the address exists.
      sendResetEmail(user, trustedBaseUrl(req)).catch((e) => console.error("Failed to send password-reset email", e));
    }
  }
  return { status: true, message: "If an account exists for that email, a reset link has been sent." };
}

const failure = (message: string) => json({ status: false, message }, 400);

export async function confirmReset(req: Request) {
  const data = (await jsonBody<Record<string, unknown>>(req)) ?? {};
  const get = (k: string) => (pyTruthy(data[k]) ? data[k] : undefined);
  const uid = get("uid");
  const token = get("token");
  const newPassword = get("new_password");
  if (uid === undefined || token === undefined || newPassword === undefined) return failure("Missing parameters");
  const invalid = () => failure("Invalid or expired reset link");
  if (typeof uid !== "string" || typeof token !== "string" || typeof newPassword !== "string") return invalid();
  const pk = decodeUid(uid);
  if (pk === null) return invalid();
  const user = await plainUser(pk);
  if (!user || !checkToken(user, token)) return invalid();
  const problems = validatePassword(newPassword, user);
  if (problems.length) return failure(problems.join(" "));
  await setPassword(user.id, await hashPassword(newPassword));
  return { status: true, message: "Password has been reset" };
}
