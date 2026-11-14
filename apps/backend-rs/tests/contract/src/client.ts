import { BASE_URL } from "./env";
import { manifest, type Role } from "./manifest";

export interface Request {
  method?: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Path as the frontend writes it, including the /api prefix: "/api/user/2/". */
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  /** JSON body (serialized for you) unless `rawBody` is given. */
  body?: unknown;
  rawBody?: BodyInit;
  headers?: Record<string, string>;
  /** "manual" to see Django's 301 for a missing trailing slash instead of following it. */
  redirect?: RequestRedirect;
}

export interface Response<T = unknown> {
  status: number;
  headers: Headers;
  /** Parsed JSON, the text for non-JSON bodies, null for an empty body. */
  body: T;
  text: string;
  url: string;
}

interface Tokens {
  access: string;
  refresh: string;
  at: number;
}

// simplejwt's access tokens live 5 minutes; log in again well before that.
const TOKEN_MAX_AGE_MS = 4 * 60 * 1000;
const tokens = new Map<string, Tokens>();

export async function login(role: Exclude<Role, "anonymous">, baseUrl = BASE_URL): Promise<Tokens> {
  const key = `${baseUrl} ${role}`;
  const hit = tokens.get(key);
  if (hit && Date.now() - hit.at < TOKEN_MAX_AGE_MS) return hit;
  const { username, password } = manifest().users[role];
  const res = await fetch(`${baseUrl}/api/auth/token/obtain/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (res.status !== 200) {
    throw new Error(`login as ${role} on ${baseUrl} failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { access: string; refresh: string };
  const fresh = { access: body.access, refresh: body.refresh, at: Date.now() };
  tokens.set(key, fresh);
  return fresh;
}

export function forgetTokens(): void {
  tokens.clear();
}

/** Call `req` as `role` against `baseUrl` (default LP_BASE_URL). */
export async function call<T = unknown>(role: Role, req: Request, baseUrl = BASE_URL): Promise<Response<T>> {
  if (!baseUrl) throw new Error("LP_BASE_URL is not set");
  const headers: Record<string, string> = { Accept: "application/json", ...req.headers };
  if (role !== "anonymous") {
    headers.Authorization ??= `Bearer ${(await login(role, baseUrl)).access}`;
  }
  let body: BodyInit | undefined = req.rawBody;
  if (body === undefined && req.body !== undefined) {
    body = JSON.stringify(req.body);
    headers["Content-Type"] ??= "application/json";
  }
  const res = await fetch(baseUrl + withQuery(req.path, req.query), {
    method: req.method ?? "GET",
    headers,
    body,
    redirect: req.redirect ?? "follow",
  });
  const text = req.method === "HEAD" ? "" : await res.text();
  return { status: res.status, headers: res.headers, body: parseBody(text, res.headers) as T, text, url: res.url };
}

export function withQuery(path: string, query?: Request["query"]): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) params.append(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${path}${path.includes("?") ? "&" : "?"}${qs}` : path;
}

function parseBody(text: string, headers: Headers): unknown {
  if (text === "") return null;
  if ((headers.get("content-type") ?? "").includes("json")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

/** Decoded JWT payload (no signature check). */
export function jwtClaims(token: string): Record<string, unknown> {
  const payload = token.split(".")[1] ?? "";
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
}
