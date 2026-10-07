// simplejwt token endpoints (port of lp_auth::routes): obtain, refresh,
// blacklist. Obtain and refresh also set the `jwt` cookie media auth relies on.
import { client } from "../lib/db";
import { ApiError, type FieldError } from "../lib/errors";
import { json, jsonBody, tokenError } from "../lib/http";
import { accessFromRefresh, claimsUserId, decodeJwt, issuePair, jwtCookie } from "../lib/jwt";
import { verifyPassword } from "../lib/password";
import { siteSettings } from "../lib/settings";
import { userByUsername } from "../lib/users";

/** DRF CharField(required) coercion of one JSON field. */
export function requiredStr(field: string, body: Record<string, unknown>): string | FieldError {
  const v = body[field];
  if (v === undefined) return { field, message: "This field is required." };
  if (v === null) return { field, message: "This field may not be null." };
  if (typeof v === "string") return v.trim() === "" ? { field, message: "This field may not be blank." } : v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "True" : "False";
  return { field, message: "Not a valid string." };
}

export function validate(...fields: (string | FieldError)[]): string[] {
  const errors = fields.filter((f): f is FieldError => typeof f !== "string");
  if (errors.length) throw ApiError.fields(400, errors);
  return fields as string[];
}

function withJwtCookie(body: unknown, access: string) {
  return json(body, 200, { "Set-Cookie": jwtCookie(access), "Access-Control-Allow-Credentials": "true" });
}

export async function obtain(req: Request) {
  const body = await jsonBody(req);
  const [username, password] = validate(requiredStr("username", body), requiredStr("password", body));
  const noAccount = () => ApiError.unauthorized("No active account found with the given credentials");
  const user = await userByUsername(username);
  if (!user) throw noAccount();
  if (!(await verifyPassword(password, user.password)) || !user.isActive) throw noAccount();
  const settings = await siteSettings();
  const pair = issuePair(user, settings.NEXTCLOUD_ENABLED);
  await client`INSERT INTO refresh_token (jti, user_id, expires_at) VALUES (${pair.refreshClaims.jti}, ${user.id}, to_timestamp(${pair.refreshClaims.exp})) ON CONFLICT (jti) DO NOTHING`;
  return withJwtCookie({ refresh: pair.refresh, access: pair.access }, pair.access);
}

async function revoked(jti: string): Promise<boolean> {
  const [r] = await client`SELECT EXISTS (SELECT 1 FROM refresh_token WHERE jti = ${jti} AND revoked_at IS NOT NULL) AS r`;
  return r.r;
}

export async function refresh(req: Request) {
  const [token] = validate(requiredStr("refresh", await jsonBody(req)));
  const claims = decodeJwt(token, "refresh");
  if (typeof claims === "string") throw tokenError(claims);
  if (await revoked(claims.jti)) throw tokenError("Token is blacklisted");
  const uid = claimsUserId(claims);
  if (uid !== null) {
    const [a] = await client`SELECT EXISTS (SELECT 1 FROM api_user WHERE id = ${uid} AND is_active) AS a`;
    if (!a.a) throw ApiError.unauthorized("No active account found for the given token.");
  }
  const access = accessFromRefresh(claims);
  return withJwtCookie({ access }, access);
}

export async function blacklist(req: Request) {
  const [token] = validate(requiredStr("refresh", await jsonBody(req)));
  const claims = decodeJwt(token, "refresh");
  if (typeof claims === "string") throw tokenError(claims);
  if (await revoked(claims.jti)) throw tokenError("Token is blacklisted");
  const uid = claimsUserId(claims);
  if (uid !== null) {
    await client`INSERT INTO refresh_token (jti, user_id, expires_at, revoked_at) VALUES (${claims.jti}, ${uid}, to_timestamp(${claims.exp}), now())
      ON CONFLICT (jti) DO UPDATE SET revoked_at = COALESCE(refresh_token.revoked_at, now())`;
  }
  return json({});
}
