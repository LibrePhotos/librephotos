// OIDC single sign-on (api/views/sso.py + api/adapters.py, which run
// allauth). Port of lp_api::users_settings::oidc + sso and
// lp_db::users_settings::sso.
//
// GET /api/accounts/oidc/<id>/login/ redirects to the identity provider;
// .../login/callback/ exchanges the code, applies LibrePhotos' linking and
// provisioning policy and ends like sso_finish: the password login's
// access/refresh pair in the access, refresh and jwt cookies and a redirect
// to /. Failures go to /login?sso_error=<reason>.
//
// Providers are allauth SocialApp rows when that table exists, plus
// LP_OIDC_PROVIDERS (a JSON list of {id, name, client_id, secret, server_url,
// settings?}). allauth keeps the flow state in the Django session; here it is
// a signed, short-lived HttpOnly cookie scoped to /api/accounts/oidc/.
//
// Differences from allauth (same as librephotos-rs): the ID token signature
// is always checked against the JWKS, a nonce is sent and checked, IdP-side
// errors redirect to the SPA, an email shared by several accounts is refused
// (ambiguous_email), a taken preferred_username gets a numeric suffix.
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import { sql } from "drizzle-orm";
import { db, jsonbParam, row, rows, type Tx } from "~/lib/db";
import { ApiError } from "~/lib/errors";
import { cookieValue } from "~/lib/http";
import { issuePair } from "~/lib/jwt";
import type { QueryMap } from "~/lib/query";
import { siteSettings } from "~/lib/settings";
import { userById } from "~/lib/users";
import { config } from "~/lib/config";
import { createUser, plainUser, tableExists } from "./db";
import { emailIsConfigured } from "./email";
import { autoCreateUserDirectory } from "./scan_dir";
import { requestOrigin } from "./serialize";

const STATE_COOKIE = "lp_oidc";
const STATE_PATH = "/api/accounts/oidc/";
const STATE_TTL_SECS = 600;
/** Django's SITE_ID: allauth lists only the apps attached to it. */
const SITE_ID = 1;

interface Provider {
  id: string;
  /** What allauth stores in SocialAccount.provider. */
  accountProvider: string;
  name: string;
  clientId: string;
  secret: string;
  settings: Record<string, unknown>;
}

/** LP_OIDC_PROVIDERS; a malformed value is logged and ignored. */
function envProviders(): Provider[] {
  const raw = process.env.LP_OIDC_PROVIDERS;
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as Record<string, unknown>[];
    if (!Array.isArray(list)) throw new Error("not a list");
    return list.map((p) => {
      if (typeof p.id !== "string" || typeof p.client_id !== "string" || typeof p.server_url !== "string") throw new Error("missing field");
      const settings = { ...((p.settings as Record<string, unknown>) ?? {}), server_url: p.server_url };
      const name = typeof p.name === "string" && p.name ? p.name : p.id;
      return { id: p.id, accountProvider: p.id, name, clientId: p.client_id, secret: typeof p.secret === "string" ? p.secret : "", settings };
    });
  } catch (e) {
    console.error("LP_OIDC_PROVIDERS is not a valid provider list", e);
    return [];
  }
}

/** Every provider the login screen can offer: [id, name]. */
async function listProviders(): Promise<[string, string][]> {
  const out: [string, string][] = [];
  if (await tableExists("socialaccount_socialapp")) {
    const r = await rows<{ id: string; name: string }>(
      sql`SELECT COALESCE(NULLIF(provider_id, ''), client_id) AS id, name FROM socialaccount_socialapp WHERE provider = 'openid_connect' ORDER BY socialaccount_socialapp.id`,
    );
    for (const x of r) out.push([x.id, x.name]);
  }
  for (const p of envProviders()) if (!out.some(([id]) => id === p.id)) out.push([p.id, p.name]);
  return out;
}

/** GET /api/auth/sso/config/ (SSOConfigView; unauthenticated on purpose). */
export async function ssoConfig() {
  const s = await siteSettings();
  const providers = s.OIDC_ENABLED
    ? (await listProviders()).map(([id, name]) => ({ id, name, login_url: `/api/accounts/oidc/${id}/login/` }))
    : [];
  return { enabled: s.OIDC_ENABLED && providers.length > 0, label: s.OIDC_BUTTON_LABEL, providers };
}

/** The app behind /api/accounts/oidc/<id>/..., restricted to SITE_ID like SocialApp.objects.on_site. */
async function findProvider(id: string): Promise<Provider | undefined> {
  const t = await row<{ app: boolean; sites: boolean }>(
    sql`SELECT to_regclass('public.socialaccount_socialapp') IS NOT NULL AS app, to_regclass('public.socialaccount_socialapp_sites') IS NOT NULL AS sites`,
  );
  if (t?.app) {
    const siteFilter = t.sites
      ? sql`AND EXISTS (SELECT 1 FROM socialaccount_socialapp_sites s WHERE s.socialapp_id = a.id AND s.site_id = ${SITE_ID})`
      : sql``;
    const a = await row<{ id: string; account_provider: string; name: string; client_id: string; secret: string; settings: unknown }>(
      sql`SELECT COALESCE(NULLIF(a.provider_id, ''), a.client_id) AS id, COALESCE(NULLIF(a.provider_id, ''), a.provider) AS account_provider,
            a.name, a.client_id, a.secret, a.settings FROM socialaccount_socialapp a
          WHERE a.provider = 'openid_connect' AND COALESCE(NULLIF(a.provider_id, ''), a.client_id) = ${id} ${siteFilter}
          ORDER BY a.id LIMIT 1`,
    );
    if (a) {
      const settings = typeof a.settings === "string" ? JSON.parse(a.settings) : a.settings;
      return {
        id: a.id,
        accountProvider: a.account_provider,
        name: a.name,
        clientId: a.client_id,
        secret: a.secret,
        settings: (settings && typeof settings === "object" ? settings : {}) as Record<string, unknown>,
      };
    }
  }
  return envProviders().find((p) => p.id === id);
}

/** public_base_url: FRONTEND_BASE_URL, else the request's origin. */
function publicBaseUrl(req: Request): string {
  const configured = (process.env.FRONTEND_BASE_URL ?? "").replace(/\/+$/, "");
  return configured || requestOrigin(req);
}

/** is_internal_base_url: a host only the Docker network resolves. */
function isInternalBaseUrl(base: string): boolean {
  if (!base) return true;
  const i = base.indexOf("://");
  const host = (i >= 0 ? base.slice(i + 3) : base).split("/")[0].split(":")[0];
  return host === "backend" || host === (process.env.BACKEND_HOST ?? "backend");
}

function redirect(location: string, cookies: string[] = [], extra: Record<string, string> = {}): Response {
  const h = new Headers({ Location: location, ...extra });
  for (const c of cookies) h.append("Set-Cookie", c);
  return new Response(null, { status: 302, headers: h });
}

const clearStateCookie = () => `${STATE_COOKIE}=; Path=${STATE_PATH}; Max-Age=0; HttpOnly; SameSite=Lax`;
const ssoError = (reason: string) => redirect(`/login?sso_error=${reason}`, [clearStateCookie()]);
const callbackUrl = (base: string, id: string) => `${base}/api/accounts/oidc/${encodeURIComponent(id)}/login/callback/`;

function setting(p: Provider, key: string): unknown {
  const v = p.settings[key];
  return v === null ? undefined : v;
}

interface Metadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
  jwks_uri: string;
  token_endpoint_auth_methods_supported?: string[];
}

const jwksCache = new Map<string, JWTVerifyGetKey>();

/** The discovery document (redirects followed, like allauth's requests session). */
async function metadata(p: Provider): Promise<Metadata> {
  const serverUrl = setting(p, "server_url");
  if (typeof serverUrl !== "string") throw new Error("provider has no server_url");
  const url = serverUrl.includes("/.well-known/") ? serverUrl : `${serverUrl.replace(/\/+$/, "")}/.well-known/openid-configuration`;
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`discovery: HTTP ${res.status}`);
  const m = (await res.json()) as Metadata;
  for (const k of ["issuer", "authorization_endpoint", "token_endpoint", "jwks_uri"] as const) {
    if (typeof m[k] !== "string") throw new Error(`discovery document: no ${k}`);
  }
  return m;
}

/** allauth's basic_auth: the app's token_auth_method, else basic only when supported and post is not. */
function useBasicAuth(p: Provider, m: Metadata): boolean {
  const method = setting(p, "token_auth_method");
  if (typeof method === "string") return method === "client_secret_basic";
  const methods = m.token_endpoint_auth_methods_supported ?? [];
  return !methods.includes("client_secret_post") && methods.includes("client_secret_basic");
}

interface FlowState {
  p: string;
  s: string;
  n: string;
  v?: string;
  e: number;
}

function stateKey(): Buffer {
  return createHmac("sha256", config.secretKey).update("librephotos.oidc.state").digest();
}

function signState(flow: FlowState): string {
  const ordered: Record<string, unknown> = { p: flow.p, s: flow.s, n: flow.n };
  if (flow.v !== undefined) ordered.v = flow.v;
  ordered.e = flow.e;
  const body = Buffer.from(JSON.stringify(ordered)).toString("base64url");
  const sig = createHmac("sha256", stateKey()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verifyState(value: string): FlowState | null {
  const i = value.indexOf(".");
  if (i < 0) return null;
  const body = value.slice(0, i);
  const sig = Buffer.from(value.slice(i + 1));
  const want = Buffer.from(createHmac("sha256", stateKey()).update(body).digest("base64url"));
  if (want.length !== sig.length || !timingSafeEqual(want, sig)) return null;
  try {
    const f = JSON.parse(Buffer.from(body, "base64url").toString()) as FlowState;
    if (typeof f.p !== "string" || typeof f.s !== "string" || typeof f.n !== "string" || typeof f.e !== "number") return null;
    return f.e > Math.floor(Date.now() / 1000) ? f : null;
  } catch {
    return null;
  }
}

const random = (n = 16) => randomBytes(n).toString("base64url");

async function requireEnabled() {
  if (!(await siteSettings()).OIDC_ENABLED) throw ApiError.notFound();
}

/** oidc_login */
export async function oidcLogin(id: string, req: Request): Promise<Response> {
  await requireEnabled();
  const base = publicBaseUrl(req);
  if (isInternalBaseUrl(base)) return redirect("/login?sso_error=public_url_not_configured");
  const provider = await findProvider(id);
  if (!provider) throw ApiError.notFound();
  let authUrl: URL;
  const flow: FlowState = { p: provider.id, s: random(), n: random(), e: Math.floor(Date.now() / 1000) + STATE_TTL_SECS };
  try {
    const m = await metadata(provider);
    authUrl = new URL(m.authorization_endpoint);
    const scopeSetting = setting(provider, "scope");
    const scopes = Array.isArray(scopeSetting) ? scopeSetting.filter((s): s is string => typeof s === "string") : ["profile", "email"];
    const q = authUrl.searchParams;
    q.set("response_type", "code");
    q.set("client_id", provider.clientId);
    q.set("state", flow.s);
    q.set("redirect_uri", callbackUrl(base, provider.id));
    q.set("scope", ["openid", ...scopes.filter((s) => s !== "openid")].join(" "));
    q.set("nonce", flow.n);
    const extra = setting(provider, "auth_params");
    if (extra && typeof extra === "object" && !Array.isArray(extra)) {
      for (const [k, v] of Object.entries(extra)) if (typeof v === "string") q.set(k, v);
    }
    if (setting(provider, "oauth_pkce_enabled") === true) {
      flow.v = random(32);
      q.set("code_challenge", createHash("sha256").update(flow.v).digest("base64url"));
      q.set("code_challenge_method", "S256");
    }
  } catch (e) {
    console.error(`SSO login could not start (provider ${provider.id}):`, e);
    return ssoError("provider_error");
  }
  const secure = base.startsWith("https://") ? "; Secure" : "";
  return redirect(authUrl.toString(), [
    `${STATE_COOKIE}=${signState(flow)}; Path=${STATE_PATH}; Max-Age=${STATE_TTL_SECS}; HttpOnly; SameSite=Lax${secure}`,
  ]);
}

interface Identity {
  uid: string;
  email: string;
  emailVerified: boolean;
  preferredUsername: string;
  name: string;
  givenName: string;
  familyName: string;
  extraData: Record<string, unknown>;
}

const strClaim = (c: Record<string, unknown>, k: string) => (typeof c[k] === "string" ? (c[k] as string) : "");
const boolClaim = (c: Record<string, unknown>, k: string) => c[k] === true || c[k] === "true";

/** oidc_callback: code exchange, then the adapter policy. */
export async function oidcCallback(id: string, req: Request, query: QueryMap): Promise<Response> {
  await requireEnabled();
  const provider = await findProvider(id);
  if (!provider) throw ApiError.notFound();
  const err = query.nonEmpty("error");
  if (err) {
    console.warn(`the identity provider refused the login (provider ${provider.id}): ${err} ${query.nonEmpty("error_description") ?? ""}`);
    return ssoError("provider_error");
  }
  const cookie = cookieValue(req, STATE_COOKIE);
  const flow = cookie ? verifyState(cookie) : null;
  if (!flow || flow.p !== provider.id) return ssoError("invalid_state");
  const stateParam = Buffer.from(query.nonEmpty("state") ?? "");
  const expected = Buffer.from(flow.s);
  if (stateParam.length !== expected.length || !timingSafeEqual(stateParam, expected)) return ssoError("invalid_state");
  const code = query.nonEmpty("code");
  if (!code) return ssoError("provider_error");
  let identity: Identity;
  try {
    identity = await exchange(provider, publicBaseUrl(req), code, flow);
  } catch (e) {
    console.error(`SSO callback failed (provider ${provider.id}):`, e);
    return ssoError("provider_error");
  }
  return finish(provider, identity);
}

/** Signed algorithms only; HMAC ones are keyed with the client secret, so never for a public client. */
function allowedAlgs(hasSecret: boolean): string[] {
  const asym = ["RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "EdDSA"];
  return hasSecret ? [...asym, "HS256", "HS384", "HS512"] : asym;
}

async function exchange(p: Provider, base: string, code: string, flow: FlowState): Promise<Identity> {
  const m = await metadata(p);
  const form = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: callbackUrl(base, p.id) });
  if (flow.v) form.set("code_verifier", flow.v);
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };
  if (useBasicAuth(p, m)) {
    const enc = (s: string) => encodeURIComponent(s);
    headers.Authorization = "Basic " + Buffer.from(`${enc(p.clientId)}:${enc(p.secret)}`).toString("base64");
  } else {
    form.set("client_id", p.clientId);
    if (p.secret) form.set("client_secret", p.secret);
  }
  // The token and userinfo requests never follow redirects: the code and the secret stay put.
  const tr = await fetch(m.token_endpoint, { method: "POST", headers, body: form, redirect: "manual", signal: AbortSignal.timeout(30_000) });
  if (!tr.ok) throw new Error(`token exchange: HTTP ${tr.status}`);
  const token = (await tr.json()) as { id_token?: string; access_token?: string };
  if (!token.id_token) throw new Error("the token response has no id_token");
  let jwks = jwksCache.get(m.jwks_uri);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(m.jwks_uri));
    jwksCache.set(m.jwks_uri, jwks);
  }
  const secretKey = new TextEncoder().encode(p.secret);
  const keyFor: JWTVerifyGetKey = (header, tok) => (header.alg?.startsWith("HS") ? secretKey : jwks!(header, tok));
  const { payload } = await jwtVerify(token.id_token, keyFor, {
    issuer: m.issuer,
    audience: p.clientId,
    algorithms: allowedAlgs(p.secret !== ""),
  });
  const claims = payload as JWTPayload & Record<string, unknown>;
  if (claims.nonce !== flow.n) throw new Error("id_token: nonce mismatch");
  if (Array.isArray(claims.aud) && claims.aud.length > 1 && claims.azp !== p.clientId) throw new Error("id_token: azp mismatch");
  if (typeof claims.sub !== "string" || !claims.sub) throw new Error("id_token: no subject");
  let src: Record<string, unknown> = claims;
  const ident: Identity = {
    uid: claims.sub,
    email: "",
    emailVerified: false,
    preferredUsername: "",
    name: "",
    givenName: "",
    familyName: "",
    extraData: { id_token: claims },
  };
  const fetchUserinfo = setting(p, "fetch_userinfo");
  if (fetchUserinfo !== false && m.userinfo_endpoint && token.access_token) {
    const ur = await fetch(m.userinfo_endpoint, {
      headers: { Authorization: `Bearer ${token.access_token}`, Accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    if (!ur.ok) throw new Error(`userinfo: HTTP ${ur.status}`);
    const info = (await ur.json()) as Record<string, unknown>;
    if (info.sub !== claims.sub) throw new Error("userinfo: subject mismatch");
    // allauth prefers the userinfo claims over the ID token's.
    src = info;
    ident.extraData.userinfo = info;
  }
  ident.email = strClaim(src, "email");
  ident.emailVerified = boolClaim(src, "email_verified");
  ident.preferredUsername = strClaim(src, "preferred_username");
  ident.name = strClaim(src, "name");
  ident.givenName = strClaim(src, "given_name");
  ident.familyName = strClaim(src, "family_name");
  return ident;
}

async function linkIdentity(tx: Tx, userId: number, provider: string, uid: string, extra: unknown) {
  if (!(await tableExists("socialaccount_socialaccount", tx))) return;
  await tx.execute(sql`INSERT INTO socialaccount_socialaccount (provider, uid, last_login, date_joined, extra_data, user_id)
    VALUES (${provider}, ${uid}, now(), now(), ${jsonbParam(extra)}, ${userId})
    ON CONFLICT (provider, uid) DO UPDATE SET last_login = now(), extra_data = EXCLUDED.extra_data`);
}

const VALID_CHAR = /[\p{L}\p{N}_.@+-]/u;
const validUsername = (u: string) => u.length > 0 && [...u].length <= 150 && [...u].every((c) => VALID_CHAR.test(c));

async function usernameTaken(u: string): Promise<boolean> {
  const r = await row<{ t: boolean }>(sql`SELECT EXISTS (SELECT 1 FROM api_user WHERE username = ${u}) AS t`);
  return !!r?.t;
}

/** allauth generate_unique_username in spirit: the first usable candidate, made unique with a numeric suffix. */
async function uniqueUsername(ident: Identity): Promise<string> {
  const candidates = [ident.preferredUsername, ident.email.split("@")[0] ?? "", ident.givenName, ident.familyName, "user"];
  const base =
    candidates.map((c) => [...c].filter((ch) => VALID_CHAR.test(ch)).slice(0, 140).join("")).find(validUsername) ?? "user";
  if (!(await usernameTaken(base))) return base;
  for (let n = 2; n < 1000; n++) if (!(await usernameTaken(`${base}${n}`))) return `${base}${n}`;
  return `${base}${randomInt(1000, 1_000_000)}`;
}

/** save_user: a new, never privileged account with an unusable password. */
async function provision(ident: Identity, p: Provider): Promise<number> {
  const username = await uniqueUsername(ident);
  let first = ident.givenName;
  let last = ident.familyName;
  if (!first && !last) {
    const i = ident.name.indexOf(" ");
    [first, last] = i < 0 ? [ident.name, ""] : [ident.name.slice(0, i), ident.name.slice(i + 1)];
  }
  // Django make_password(None): "!" + 40 random characters.
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const unusable = "!" + Array.from({ length: 40 }, () => chars[randomInt(chars.length)]).join("");
  const email = ident.email.trim();
  const id = await db.transaction(async (tx) => {
    const newId = await createUser(
      {
        username,
        email,
        passwordHash: unusable,
        firstName: [...first].slice(0, 150).join(""),
        lastName: [...last].slice(0, 150).join(""),
        isSuperuser: false,
        isStaff: false,
        scanDirectory: "",
      },
      tx,
    );
    if (email && (await tableExists("account_emailaddress", tx))) {
      await tx.execute(sql`INSERT INTO account_emailaddress (email, verified, "primary", user_id)
        VALUES (${email}, ${ident.emailVerified}, TRUE, ${newId}) ON CONFLICT DO NOTHING`);
    }
    await linkIdentity(tx, newId, p.accountProvider, ident.uid, ident.extraData);
    return newId;
  });
  console.info(`SSO login created a new account: ${username}`);
  return id;
}

/** pre_social_login + save_user + sso_finish. */
async function finish(p: Provider, ident: Identity): Promise<Response> {
  let userId: number | undefined;
  if (await tableExists("socialaccount_socialaccount")) {
    const linked = await row<{ user_id: number }>(
      sql`SELECT user_id FROM socialaccount_socialaccount WHERE provider = ${p.accountProvider} AND uid = ${ident.uid}`,
    );
    userId = linked?.user_id;
  }
  if (userId === undefined) {
    const email = ident.email.trim().toLowerCase();
    const matches = email
      ? (await rows<{ id: number }>(sql`SELECT id FROM api_user WHERE UPPER(email) = UPPER(${email}) ORDER BY id LIMIT 2`)).map((r) => r.id)
      : [];
    if (matches.length === 1) {
      // Account-takeover guard: never attach an unverified email.
      if (!ident.emailVerified) return ssoError("email_not_verified");
      userId = matches[0];
    } else if (matches.length === 0) {
      const allowed = (await siteSettings()).OIDC_ALLOW_SIGNUP && (await emailIsConfigured());
      if (!allowed) return ssoError("signup_disabled");
      if (!ident.emailVerified) return ssoError("email_not_verified");
      userId = await provision(ident, p);
      const created = await plainUser(userId);
      if (created) await autoCreateUserDirectory(created, false);
    } else return ssoError("ambiguous_email");
  }
  const user = await userById(userId);
  if (!user) return ssoError("not_authenticated");
  if (!user.isActive) return ssoError("account_inactive");
  await db.transaction(async (tx) => {
    await linkIdentity(tx, user.id, p.accountProvider, ident.uid, ident.extraData);
    await tx.execute(sql`UPDATE api_user SET last_login = now() WHERE id = ${user.id}`);
  });
  const pair = issuePair(user, (await siteSettings()).NEXTCLOUD_ENABLED);
  await db.execute(
    sql`INSERT INTO refresh_token (jti, user_id, expires_at) VALUES (${pair.refreshClaims.jti}, ${user.id}, to_timestamp(${pair.refreshClaims.exp})) ON CONFLICT (jti) DO NOTHING`,
  );
  return redirect(
    "/",
    [`access=${pair.access}; Path=/`, `refresh=${pair.refresh}; Path=/`, `jwt=${pair.access}; Path=/`, clearStateCookie()],
    { "Access-Control-Allow-Credentials": "true" },
  );
}
