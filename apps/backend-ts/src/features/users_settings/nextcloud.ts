// Nextcloud: the SSRF guard of nextcloud/server_address.py, a minimal WebDAV
// client (pyocclient list) and the two endpoints, GET /api/nextcloud/listdir/
// and /api/nextcloud/scanphotos/ (queues `nextcloud.scan`, the job kind the
// Rust worker runs). Port of lp_tasks::nextcloud + lp_api::users_settings::nextcloud.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ApiError } from "~/lib/errors";
import { json } from "~/lib/http";
import { enqueue, JobType } from "~/lib/jobs";
import { siteSettings } from "~/lib/settings";
import type { User } from "~/lib/users";
import { decryptStr } from "./crypto";
import { nextcloudAppPassword } from "./db";

export const NEXTCLOUD_SCAN_KIND = "nextcloud.scan";

/** NEXTCLOUD_ALLOW_PRIVATE_ADDRESSES (Django _env_flag, default on). */
function privateAllowed(): boolean {
  const v = process.env.NEXTCLOUD_ALLOW_PRIVATE_ADDRESSES;
  return v === undefined || ["true", "1", "yes", "on"].includes(v.trim().toLowerCase());
}

function parseV6(s: string): number[] | null {
  let str = s.split("%")[0];
  const v4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(str);
  if (v4) {
    const o = v4.slice(1).map(Number);
    if (o.some((x) => x > 255)) return null;
    str = str.slice(0, v4.index) + ((o[0] << 8) | o[1]).toString(16) + ":" + ((o[2] << 8) | o[3]).toString(16);
  }
  const halves = str.split("::");
  if (halves.length > 2) return null;
  const toNums = (h: string) => (h ? h.split(":").map((x) => (/^[0-9a-fA-F]{1,4}$/.test(x) ? parseInt(x, 16) : NaN)) : []);
  const head = toNums(halves[0]);
  const back = halves.length === 2 ? toNums(halves[1]) : [];
  const fill = 8 - head.length - back.length;
  if ((halves.length === 1 && fill !== 0) || fill < 0) return null;
  const segs = [...head, ...Array(halves.length === 2 ? fill : 0).fill(0), ...back];
  return segs.every((x) => Number.isInteger(x)) ? segs : null;
}

function v4Global(o: number[]): boolean {
  const priv =
    o[0] === 0 ||
    o[0] === 10 ||
    o[0] === 127 ||
    (o[0] === 100 && o[1] >= 64 && o[1] < 128) ||
    (o[0] === 169 && o[1] === 254) ||
    (o[0] === 172 && o[1] >= 16 && o[1] < 32) ||
    (o[0] === 192 && o[1] === 0 && o[2] === 0) ||
    (o[0] === 192 && o[1] === 0 && o[2] === 2) ||
    (o[0] === 192 && o[1] === 168) ||
    (o[0] === 198 && (o[1] === 18 || o[1] === 19)) ||
    (o[0] === 198 && o[1] === 51 && o[2] === 100) ||
    (o[0] === 203 && o[1] === 0 && o[2] === 113) ||
    o[0] >= 240;
  return !priv;
}

function v4Refusal(o: number[], allowPrivate: boolean): string | null {
  if (o[0] === 0) return "an unspecified";
  if (o[0] === 127) return "a loopback";
  if (o[0] === 169 && o[1] === 254) return "a link-local";
  if (o[0] >= 224 && o[0] < 240) return "a multicast";
  if (o[0] >= 240) return "a reserved";
  if (!v4Global(o) && !allowPrivate) return "a private network";
  return null;
}

/** _refusal: the kind of address that must not be contacted, if any. */
export function refusal(ip: string, allowPrivate: boolean): string | null {
  if (isIP(ip) === 4) return v4Refusal(ip.split(".").map(Number), allowPrivate);
  const s = parseV6(ip);
  if (!s) return "a reserved";
  // ::ffff:a.b.c.d, 2002::/16 (6to4) and 64:ff9b::/96 carry an IPv4 address.
  const mapped = s.slice(0, 5).every((x) => x === 0) && s[5] === 0xffff;
  const sixToFour = s[0] === 0x2002;
  const nat64 = s[0] === 0x64 && s[1] === 0xff9b && s.slice(2, 6).every((x) => x === 0);
  if (mapped || nat64) return v4Refusal([s[6] >> 8, s[6] & 255, s[7] >> 8, s[7] & 255], allowPrivate);
  if (sixToFour) return v4Refusal([s[1] >> 8, s[1] & 255, s[2] >> 8, s[2] & 255], allowPrivate);
  const zero = s.every((x) => x === 0);
  if (zero) return "an unspecified";
  if (s.slice(0, 7).every((x) => x === 0) && s[7] === 1) return "a loopback";
  if ((s[0] & 0xffc0) === 0xfe80) return "a link-local";
  if ((s[0] & 0xff00) === 0xff00) return "a multicast";
  const s0 = s[0];
  const reserved = s0 < 0x2000 || (s0 >= 0x4000 && s0 < 0xfc00) || (s0 >= 0xfe00 && s0 < 0xfe80);
  if (reserved) return "a reserved";
  const priv =
    (s0 & 0xfe00) === 0xfc00 ||
    (s0 === 0x2001 && s[1] < 0x200) ||
    (s0 === 0x2001 && s[1] === 0xdb8) ||
    (s0 === 0x100 && s[1] === 0 && s[2] === 0 && s[3] === 0);
  if (priv && !allowPrivate) return "a private network";
  return null;
}

/** Resolve `host` and refuse it when any address must not be contacted. */
async function resolveChecked(host: string): Promise<string | null> {
  const unresolved = `The Nextcloud server address could not be resolved: ${host}`;
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    return unresolved;
  }
  if (!addrs.length) return unresolved;
  const allow = privateAllowed();
  for (const a of addrs) {
    const kind = refusal(a.address, allow);
    if (kind) {
      const hint = kind === "a private network" ? " An administrator can allow it with NEXTCLOUD_ALLOW_PRIVATE_ADDRESSES=true." : "";
      return `The Nextcloud server address points to ${kind} address, which LibrePhotos does not connect to.${hint}`;
    }
  }
  return null;
}

function splitHostPort(authority: string): [string, number | null] | null {
  let host: string;
  let port: string | undefined;
  if (authority.startsWith("[")) {
    const i = authority.indexOf("]");
    if (i < 0) return null;
    host = authority.slice(1, i);
    const tail = authority.slice(i + 1);
    port = tail.startsWith(":") ? tail.slice(1) : undefined;
  } else {
    const i = authority.lastIndexOf(":");
    host = i < 0 ? authority : authority.slice(0, i);
    port = i < 0 ? undefined : authority.slice(i + 1);
  }
  if (port === undefined || port === "") return [host.toLowerCase(), null];
  if (!/^\d+$/.test(port) || Number(port) > 65535) return null;
  return [host.toLowerCase(), Number(port)];
}

/**
 * validate_server_address: the Django checks on the host Python's urlparse
 * sees, then the same checks on the host WHATWG URL parsing would dial (the
 * parsers disagree on inputs like `http://127.0.0.1\@example.com/`). Returns
 * the parsed URL or the refusal message.
 */
export async function checkAddress(raw: string): Promise<{ url: URL } | { error: string }> {
  const url = raw.trim();
  if (!url) return { error: "No Nextcloud server address is set." };
  const colon = url.indexOf(":");
  const s = colon < 0 ? "" : url.slice(0, colon);
  const scheme = /^[A-Za-z][A-Za-z0-9+.-]*$/.test(s) ? s.toLowerCase() : "";
  if (scheme !== "http" && scheme !== "https") return { error: "The Nextcloud server address has to start with http:// or https://." };
  const after = url.slice(scheme.length + 1);
  if (!after.startsWith("//")) return { error: "The Nextcloud server address has no host name." };
  const authority = after.slice(2).split(/[/?#]/)[0].split("@").pop() ?? "";
  const hp = splitHostPort(authority);
  if (!hp) return { error: "The Nextcloud server address is not a URL." };
  const [host, port] = hp;
  if (!host) return { error: "The Nextcloud server address has no host name." };
  const defPort = scheme === "https" ? 443 : 80;
  const err = await resolveChecked(host);
  if (err) return { error: err };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { error: "The Nextcloud server address is not a URL." };
  }
  const dialHost = parsed.hostname.replace(/^\[|\]$/g, "");
  if (!dialHost) return { error: "The Nextcloud server address has no host name." };
  const dialPort = parsed.port ? Number(parsed.port) : defPort;
  if (!(dialHost.toLowerCase() === host && dialPort === (port ?? defPort))) {
    const e2 = await resolveChecked(dialHost);
    if (e2) return { error: e2 };
  }
  return { url: parsed };
}

export async function validateServerAddress(url: string): Promise<string | null> {
  const r = await checkAddress(url);
  return "error" in r ? r.error : null;
}

class DavError extends Error {}

const unescapeXml = (s: string) =>
  s.trim().replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** Every entry of a multistatus body except the listed directory itself. */
export function parseEntries(body: string, davRoot: string): { path: string; isDir: boolean }[] {
  const out: { path: string; isDir: boolean }[] = [];
  const re = /<(?:[\w-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?response>/g;
  let i = 0;
  for (const m of body.matchAll(re)) {
    if (i++ === 0) continue;
    const block = m[1];
    const h = /<(?:[\w-]+:)?href\b[^>]*>([\s\S]*?)<\//.exec(block);
    if (!h) continue;
    let decoded: string;
    try {
      decoded = decodeURIComponent(unescapeXml(h[1]));
    } catch {
      decoded = unescapeXml(h[1]);
    }
    const at = decoded.indexOf(davRoot);
    out.push({ path: at >= 0 ? decoded.slice(at + davRoot.length) : decoded, isDir: /<(?:[\w-]+:)?collection\b/.test(block) });
  }
  return out;
}

/** should_strip_auth: credentials stay with the origin they were set for. */
function shouldStripAuth(oldU: URL, newU: URL): boolean {
  if (oldU.hostname !== newU.hostname) return true;
  const defPort = (u: URL) => (u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80);
  if (oldU.protocol === "http:" && defPort(oldU) === 80 && newU.protocol === "https:" && defPort(newU) === 443) return false;
  return oldU.protocol !== newU.protocol || defPort(oldU) !== defPort(newU);
}

/** pyocclient list over PROPFIND (Depth 1); every hop is checked before it is dialled. */
async function davList(address: string, user: string, password: string, dir: string) {
  const base = address.trim().endsWith("/") ? address.trim() : address.trim() + "/";
  const afterScheme = base.split("://")[1] ?? "";
  const slash = afterScheme.indexOf("/");
  let rootPath = slash >= 0 ? afterScheme.slice(slash) : "/";
  if (!rootPath.endsWith("/")) rootPath += "/";
  rootPath += "remote.php/webdav";
  const p = dir.startsWith("/") ? dir : "/" + dir;
  let url = base + "remote.php/webdav" + encodeURI(p).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  let sendAuth = true;
  for (let hop = 0; hop < 10; hop++) {
    const checked = await checkAddress(url);
    if ("error" in checked) throw new DavError(checked.error);
    const headers: Record<string, string> = { Depth: "1" };
    if (sendAuth) headers.Authorization = "Basic " + Buffer.from(`${user}:${password}`).toString("base64");
    let res: Response;
    try {
      res = await fetch(checked.url, { method: "PROPFIND", headers, redirect: "manual", signal: AbortSignal.timeout(60_000) });
    } catch {
      throw new DavError("Could not reach the nextcloud server. Check the server address.");
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new DavError(`HTTP error: ${res.status}`);
      const next = new URL(loc, checked.url);
      if (shouldStripAuth(checked.url, next)) sendAuth = false;
      url = next.toString();
      continue;
    }
    if (res.status !== 207 && !res.ok) throw new DavError(`HTTP error: ${res.status}`);
    return parseEntries(await res.text(), rootPath);
  }
  throw new DavError("Could not reach the nextcloud server. Check the server address.");
}

const rejected = (message: string) => json({ status: false, message }, 400);

async function requireEnabled() {
  if (!(await siteSettings()).NEXTCLOUD_ENABLED) throw ApiError.permissionDenied();
}

/** GET /api/nextcloud/listdir/?fpath= */
export async function listdir(user: User, fpath: string | undefined) {
  await requireEnabled();
  if (!fpath || !user.nextcloudServerAddress) return [];
  const bad = await validateServerAddress(user.nextcloudServerAddress.trim());
  if (bad) return rejected(bad);
  const password = decryptStr(await nextcloudAppPassword(user.id)) ?? "";
  try {
    const entries = await davList(user.nextcloudServerAddress, user.nextcloudUsername, password, fpath);
    return entries
      .filter((e) => e.isDir)
      .map((e) => {
        const parts = e.path.split("/");
        return { absolute_path: e.path, title: parts.length >= 2 ? parts[parts.length - 2] : "", children: [] };
      });
  } catch (e) {
    if (e instanceof DavError) return rejected(e.message);
    throw e;
  }
}

/** ScanPhotosView: {status: true, job_id}, or 500 when the job could not be queued. */
export async function scanphotos(user: User) {
  await requireEnabled();
  const bad = await validateServerAddress(user.nextcloudServerAddress);
  if (bad) return rejected(bad);
  try {
    const { lrjId } = await enqueue(NEXTCLOUD_SCAN_KIND, { user_id: user.id }, { lrj: { jobType: JobType.ScanPhotos, userId: user.id } });
    return { status: true, job_id: lrjId };
  } catch (e) {
    console.error("could not start the Nextcloud scan", e);
    return json({ status: false, message: "Could not start the Nextcloud scan." }, 500);
  }
}
