// The endpoint wrapper every server route uses. It resolves the requester
// the way DRF does (port of lp_auth::extract), turns thrown ApiErrors into
// the error envelope and plain return values into JSON.
//
//   export const Route = createFileRoute("/api/user/$id")({
//     server: { handlers: {
//       GET: endpoint("user", async ({ user, params, query }) => ({ ... })),
//     } },
//   });
//
// Auth modes:
//   "none"            nobody is resolved (login, endpoints that ignore auth)
//   "optional"        DRF default authentication; anonymous passes; a bad
//                     Bearer token is still a 401
//   "user"            signed-in, active (401 otherwise)
//   "admin"           is_staff (403 otherwise)
//   "cookie"          like "user" but also the `jwt` cookie (media, downloads)
//   "cookie-optional" like "optional" plus the cookie
import { ApiError, errorResponse } from "./errors";
import { claimsUserId, decodeJwt } from "./jwt";
import { verifyPassword } from "./password";
import { QueryMap } from "./query";
import { isAdmin, userById, userByUsername, type User } from "./users";

/** Set by server.ts to the TCP peer address (Django's REMOTE_ADDR). */
export const PEER_HEADER = "x-lp-peer-ip";
export const peerAddress = (req: Request) => req.headers.get(PEER_HEADER) ?? undefined;

export type AuthMode = "none" | "optional" | "user" | "admin" | "cookie" | "cookie-optional";
type UserFor<M extends AuthMode> = M extends "user" | "admin" | "cookie" ? User : User | null;

export interface Ctx<U> {
  request: Request;
  params: Record<string, string>;
  url: URL;
  query: QueryMap;
  user: U;
}

export type Result = Response | object | string | number | boolean | null | undefined;

/** simplejwt's InvalidToken: 401 detail plus a {field: code, message: token_not_valid} entry. */
export function tokenError(message: string): ApiError {
  const e = ApiError.unauthorized(message);
  e.errors.push({ field: "code", message: "token_not_valid" });
  return e;
}

/** Raw bearer token: undefined when absent or another scheme. */
function headerToken(req: Request, anyCase: boolean): string | undefined {
  const h = req.headers.get("authorization");
  if (!h) return undefined;
  const pieces = h.split(/\s+/).filter(Boolean);
  const scheme = pieces[0];
  if (!scheme || !(scheme === "Bearer" || (anyCase && scheme.toLowerCase() === "bearer"))) return undefined;
  if (pieces.length !== 2) throw ApiError.unauthorized("Authorization header must contain two space-delimited values");
  return pieces[1];
}

export function cookieValue(req: Request, name: string): string | undefined {
  const c = req.headers.get("cookie");
  if (!c) return undefined;
  for (const part of c.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

async function userForToken(token: string): Promise<User> {
  const claims = decodeJwt(token, "access");
  if (typeof claims === "string") throw tokenError("Given token not valid for any token type");
  const uid = claimsUserId(claims);
  if (uid === null) throw ApiError.unauthorized("Token contained no recognizable user identification");
  const user = await userById(uid);
  if (!user) throw ApiError.unauthorized("User not found");
  if (!user.isActive) throw ApiError.unauthorized("User is inactive");
  return user;
}

/** DRF BasicAuthentication: undefined without a Basic header. */
async function basicUser(req: Request): Promise<User | undefined> {
  const h = req.headers.get("authorization");
  if (!h) return undefined;
  const pieces = h.split(/\s+/).filter(Boolean);
  if (!pieces[0] || pieces[0].toLowerCase() !== "basic") return undefined;
  if (pieces.length === 1) throw ApiError.unauthorized("Invalid basic header. No credentials provided.");
  if (pieces.length > 2) throw ApiError.unauthorized("Invalid basic header. Credentials string should not contain spaces.");
  const bad = () => ApiError.unauthorized("Invalid basic header. Credentials not correctly base64 encoded.");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(pieces[1])) throw bad();
  const raw = Buffer.from(pieces[1], "base64");
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    decoded = raw.toString("latin1");
  }
  const i = decoded.indexOf(":");
  if (i < 0) throw bad();
  const user = await userByUsername(decoded.slice(0, i));
  const invalid = () => ApiError.unauthorized("Invalid username/password.");
  if (!user) throw invalid();
  if (!(await verifyPassword(decoded.slice(i + 1), user.password)) || !user.isActive) throw invalid();
  return user;
}

/** The requester by header only, or null for anonymous. */
export async function resolveUser(req: Request): Promise<User | null> {
  const token = headerToken(req, false);
  if (token !== undefined) return userForToken(token);
  return (await basicUser(req)) ?? null;
}

/** The requester by header, else by the jwt cookie, or null. */
export async function resolveUserWithCookie(req: Request): Promise<User | null> {
  const token = headerToken(req, true);
  if (token !== undefined) return userForToken(token);
  const cookie = cookieValue(req, "jwt");
  if (cookie) {
    try {
      return await userForToken(cookie);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) throw e;
    }
  }
  return (await basicUser(req)) ?? null;
}

async function resolveFor(mode: AuthMode, req: Request): Promise<User | null> {
  switch (mode) {
    case "none":
      return null;
    case "optional":
      return resolveUser(req);
    case "cookie-optional":
      return resolveUserWithCookie(req);
    case "cookie": {
      const u = await resolveUserWithCookie(req);
      if (!u) throw ApiError.notAuthenticated();
      return u;
    }
    case "user":
    case "admin": {
      const u = await resolveUser(req);
      if (!u) throw ApiError.notAuthenticated();
      if (mode === "admin" && !isAdmin(u)) throw ApiError.permissionDenied();
      return u;
    }
  }
}

export function toResponse(r: Result): Response {
  if (r instanceof Response) return r;
  if (r === undefined) return new Response(null, { status: 204 });
  return Response.json(r);
}

/** JSON response with a status and optional headers. */
export const json = (body: unknown, status = 200, headers?: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

export function endpoint<M extends AuthMode>(mode: M, fn: (ctx: Ctx<UserFor<M>>) => Promise<Result> | Result) {
  return async ({ request, params }: { request: Request; params?: unknown }): Promise<Response> => {
    try {
      const url = new URL(request.url);
      const user = (await resolveFor(mode, request)) as UserFor<M>;
      return toResponse(
        await fn({ request, params: (params ?? {}) as Record<string, string>, url, query: new QueryMap(url.searchParams), user }),
      );
    } catch (e) {
      return errorResponse(e);
    }
  };
}

/** JSON body; malformed JSON is a 400 detail like DRF's ParseError. Empty body = {}. */
export async function jsonBody<T = Record<string, any>>(req: Request): Promise<T> {
  const text = await req.text();
  if (!text.trim()) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    throw ApiError.badRequest("detail", `JSON parse error - ${(e as Error).message}`);
  }
}

/**
 * Body of a DRF view that accepts JSON, form-encoded and multipart data.
 * Multipart files come back as File values.
 */
export async function anyBody(req: Request): Promise<Record<string, any>> {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.startsWith("multipart/form-data") || ct.startsWith("application/x-www-form-urlencoded")) {
    const fd = await req.formData();
    const out: Record<string, any> = {};
    for (const [k, v] of fd.entries()) out[k] = v;
    return out;
  }
  return jsonBody(req);
}
