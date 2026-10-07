// simplejwt-compatible HS256 tokens (port of lp_auth::jwt). Same claim layout
// (token_type, exp, iat, jti, user_id as a string) so Django-, Rust- and
// TS-issued tokens are interchangeable on one SECRET_KEY.
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { config } from "./config";

export type Claims = Record<string, unknown> & {
  token_type: string;
  exp: number;
  iat: number;
  jti: string;
  user_id: unknown;
};

export type TokenError = "Token is invalid" | "Token is expired" | "Token has wrong type" | "Token has no type" | "Token has no id";

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const HEADER = b64url(JSON.stringify({ typ: "JWT", alg: "HS256" }));

function sign(input: string): string {
  return createHmac("sha256", config.secretKey).update(input).digest("base64url");
}

export function encodeJwt(claims: Claims): string {
  const body = `${HEADER}.${b64url(JSON.stringify(claims))}`;
  return `${body}.${sign(body)}`;
}

export function claimsUserId(c: Claims): number | null {
  const v = c.user_id;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.trim()) : NaN;
  return Number.isInteger(n) ? n : null;
}

export function decodeJwt(token: string, expectedType: "access" | "refresh"): Claims | TokenError {
  const parts = token.split(".");
  if (parts.length !== 3) return "Token is invalid";
  let header: { alg?: string };
  let claims: Claims;
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString());
  } catch {
    return "Token is invalid";
  }
  if (header.alg !== "HS256") return "Token is invalid";
  const want = Buffer.from(sign(`${parts[0]}.${parts[1]}`));
  const got = Buffer.from(parts[2]);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return "Token is invalid";
  if (typeof claims !== "object" || claims === null || typeof claims.exp !== "number") return "Token is invalid";
  if (claims.exp <= Math.floor(Date.now() / 1000)) return "Token is expired";
  if (claims.token_type === undefined) return "Token has no type";
  if (claims.token_type !== expectedType) return "Token has wrong type";
  if (typeof claims.jti !== "string") return "Token has no id";
  return claims;
}

export interface TokenUser {
  id: number;
  username: string;
  isSuperuser: boolean;
  firstName: string;
  lastName: string;
  scanDirectory: string;
  confidence: number;
  semanticSearchTopk: number;
  nextcloudServerAddress: string;
  nextcloudUsername: string;
}

export function userClaims(u: TokenUser, nextcloudEnabled: boolean): Record<string, unknown> {
  const m: Record<string, unknown> = {
    name: u.username,
    is_admin: u.isSuperuser,
    first_name: u.firstName,
    last_name: u.lastName,
    scan_directory: u.scanDirectory,
    confidence: u.confidence,
    semantic_search_topk: u.semanticSearchTopk,
  };
  if (nextcloudEnabled) {
    m.nextcloud_server_address = u.nextcloudServerAddress;
    m.nextcloud_username = u.nextcloudUsername;
  }
  return m;
}

const newJti = () => randomUUID().replaceAll("-", "");

export function accessFromRefresh(refresh: Claims): string {
  const now = Math.floor(Date.now() / 1000);
  const { token_type: _t, exp: _e, iat: _i, jti: _j, user_id, ...extra } = refresh;
  return encodeJwt({ token_type: "access", exp: now + config.accessTokenMinutes * 60, iat: now, jti: newJti(), user_id, ...extra });
}

export function issuePair(u: TokenUser, nextcloudEnabled: boolean) {
  const now = Math.floor(Date.now() / 1000);
  const refreshClaims: Claims = {
    token_type: "refresh",
    exp: now + config.refreshTokenDays * 86400,
    iat: now,
    jti: newJti(),
    user_id: String(u.id),
    ...userClaims(u, nextcloudEnabled),
  };
  return { refresh: encodeJwt(refreshClaims), access: accessFromRefresh(refreshClaims), refreshClaims };
}

/** Set-Cookie: jwt=<access>; Path=/ exactly as Django's set_cookie (not HttpOnly). */
export const jwtCookie = (access: string) => `jwt=${access}; Path=/`;
