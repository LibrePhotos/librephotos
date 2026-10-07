// Nextcloud: the WebDAV client behind /api/nextcloud/listdir/ and the
// `nextcloud.scan` job (nextcloud/directory_watcher.py scan_photos), with the
// SSRF guard of nextcloud/server_address.py. Port of lp_tasks::nextcloud.
//
// The scan lists the user's nextcloud_scan_directory recursively, downloads
// every media file not on disk yet into PHOTOS/nextcloud_media/<username>/
// (.part + rename), then hands the files to the ingest scan (`scan.user` with
// an explicit file list on the same LongRunningJob) and rebuilds the
// similarity index after it.
import { createDecipheriv, createHmac, pbkdf2Sync, randomUUID, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { createWriteStream, existsSync, mkdirSync, realpathSync, statSync } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import { config } from "../../lib/config";
import { client } from "../../lib/db";
import { JobType, enqueue, registerJob } from "../../lib/jobs";
import { buildIndex } from "./clip";
import { begin, complete, fail } from "./run";

export const KIND = "nextcloud.scan";

// --------------------------------------------------------- django-cryptography

/** django_cryptography's encrypt(pickle.dumps(str)) token, decrypted (Fernet-like, AES-256-CBC + HMAC-SHA256). */
export function decryptDjango(token: Uint8Array, secretKey: string): string | null {
  const t = Buffer.from(token);
  if (t.length < 1 + 8 + 16 + 16 + 32 || t[0] !== 0x80) return null;
  const signed = t.subarray(0, t.length - 32);
  const sig = t.subarray(t.length - 32);
  const mac = createHmac("sha256", Buffer.from(secretKey)).update(signed).digest();
  if (!timingSafeEqual(mac, sig)) return null;
  const key = pbkdf2Sync(Buffer.from(secretKey), "django-cryptography", 30000, 32, "sha256");
  let plain: Buffer;
  try {
    const d = createDecipheriv("aes-256-cbc", key, signed.subarray(9, 25));
    plain = Buffer.concat([d.update(signed.subarray(25)), d.final()]);
  } catch {
    return null;
  }
  // pickle protocol 4 of a str: PROTO, optional FRAME, (SHORT_)BINUNICODE.
  let i = 0;
  if (plain[i] === 0x80) i += 2;
  if (plain[i] === 0x95) i += 9;
  let len: number;
  let start: number;
  if (plain[i] === 0x8c) [len, start] = [plain[i + 1], i + 2];
  else if (plain[i] === 0x58) [len, start] = [plain.readUInt32LE(i + 1), i + 5];
  else return null;
  return plain.subarray(start, start + len).toString("utf8");
}

// ------------------------------------------------------------- SSRF guard

const envFlag = (name: string, d: boolean) => {
  const v = process.env[name];
  return v === undefined ? d : ["true", "1", "yes", "on"].includes(v.trim().toLowerCase());
};

function v4Octets(a: string): number[] {
  return a.split(".").map(Number);
}

/** An IPv4 address embedded in an IPv6 one (mapped, 6to4, NAT64), else null. */
function embeddedV4(segs: number[]): string | null {
  const v4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  if (segs.slice(0, 5).every((s) => s === 0) && segs[5] === 0xffff) return v4(segs[6], segs[7]);
  if (segs[0] === 0x2002) return v4(segs[1], segs[2]);
  if (segs[0] === 0x64 && segs[1] === 0xff9b && segs.slice(2, 6).every((s) => s === 0)) return v4(segs[6], segs[7]);
  return null;
}

function v6Segments(a: string): number[] {
  let s = a.toLowerCase().split("%")[0];
  const v4tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4tail) {
    const o = v4Octets(v4tail[1]);
    s = s.slice(0, -v4tail[1].length) + `${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const [head, tail] = s.split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined ? (tail ? tail.split(":") : []) : [];
  const fill = tail !== undefined ? new Array(8 - h.length - t.length).fill("0") : [];
  return [...h, ...fill, ...t].map((x) => parseInt(x || "0", 16));
}

function v4IsGlobal(o: number[]): boolean {
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

/** _refusal: the kind of address that must not be contacted, if any. */
export function refusal(addr: string, allowPrivate: boolean): string | null {
  let a = addr;
  if (isIP(a) === 6) {
    const e = embeddedV4(v6Segments(a));
    if (e) a = e;
  }
  if (isIP(a) === 4) {
    const o = v4Octets(a);
    if (o[0] === 0) return "an unspecified";
    if (o[0] === 127) return "a loopback";
    if (o[0] === 169 && o[1] === 254) return "a link-local";
    if (o[0] >= 224 && o[0] < 240) return "a multicast";
    if (o[0] >= 240) return "a reserved";
    if (!v4IsGlobal(o) && !allowPrivate) return "a private network";
    return null;
  }
  const s = v6Segments(a);
  if (s.every((x) => x === 0)) return "an unspecified";
  if (s.slice(0, 7).every((x) => x === 0) && s[7] === 1) return "a loopback";
  if ((s[0] & 0xffc0) === 0xfe80) return "a link-local";
  if ((s[0] & 0xff00) === 0xff00) return "a multicast";
  const s0 = s[0];
  if (s0 < 0x2000 || (s0 >= 0x4000 && s0 < 0xfc00) || (s0 >= 0xfe00 && s0 < 0xfe80)) return "a reserved";
  const priv =
    (s0 & 0xfe00) === 0xfc00 || (s0 === 0x2001 && s[1] < 0x200) || (s0 === 0x2001 && s[1] === 0xdb8) || (s0 === 0x100 && s[1] === 0 && s[2] === 0 && s[3] === 0);
  if (priv && !allowPrivate) return "a private network";
  return null;
}

async function resolveChecked(host: string): Promise<void> {
  let addrs: { address: string }[];
  try {
    addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  } catch {
    throw new Error(`The Nextcloud server address could not be resolved: ${host}`);
  }
  if (!addrs.length) throw new Error(`The Nextcloud server address could not be resolved: ${host}`);
  const allowPrivate = envFlag("NEXTCLOUD_ALLOW_PRIVATE_ADDRESSES", true);
  for (const { address } of addrs) {
    const kind = refusal(address, allowPrivate);
    if (kind) {
      const hint = kind === "a private network" ? " An administrator can allow it with NEXTCLOUD_ALLOW_PRIVATE_ADDRESSES=true." : "";
      throw new Error(`The Nextcloud server address points to ${kind} address, which LibrePhotos does not connect to.${hint}`);
    }
  }
}

/**
 * validate_server_address: Django's checks on the host Python's urlparse
 * sees, then on the host fetch (WHATWG) would dial; the parsers disagree on
 * inputs like `http://127.0.0.1\@example.com/`, so both must pass.
 * (The connection itself is not pinned to the checked addresses.)
 */
export async function checkAddress(raw: string): Promise<URL> {
  const url = raw.trim();
  if (!url) throw new Error("No Nextcloud server address is set.");
  const m = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(url);
  const scheme = m ? m[1].toLowerCase() : "";
  if (scheme !== "http" && scheme !== "https") throw new Error("The Nextcloud server address has to start with http:// or https://.");
  const after = url.slice(scheme.length + 1);
  if (!after.startsWith("//")) throw new Error("The Nextcloud server address has no host name.");
  const authority = after.slice(2).split(/[/?#]/)[0].split("@").pop() ?? "";
  const notUrl = () => new Error("The Nextcloud server address is not a URL.");
  let host: string;
  let port: string | undefined;
  if (authority.startsWith("[")) {
    const end = authority.indexOf("]");
    if (end < 0) throw notUrl();
    host = authority.slice(1, end);
    port = authority.slice(end + 1).replace(/^:/, "") || undefined;
  } else {
    const i = authority.lastIndexOf(":");
    [host, port] = i < 0 ? [authority, undefined] : [authority.slice(0, i), authority.slice(i + 1) || undefined];
  }
  if (port !== undefined && (!/^\d+$/.test(port) || Number(port) > 65535)) throw notUrl();
  host = host.toLowerCase();
  if (!host) throw new Error("The Nextcloud server address has no host name.");
  await resolveChecked(host);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw notUrl();
  }
  const dial = parsed.hostname.replace(/^\[|\]$/g, "");
  if (!dial) throw new Error("The Nextcloud server address has no host name.");
  if (dial.toLowerCase() !== host) await resolveChecked(dial);
  return parsed;
}

// ------------------------------------------------------------------ WebDAV

export interface DavEntry {
  path: string;
  isDir: boolean;
  contentType: string;
}

const encodePath = (p: string) =>
  [...new TextEncoder().encode(p)].map((b) => (/[A-Za-z0-9/\-_.~]/.test(String.fromCharCode(b)) && b < 128 ? String.fromCharCode(b) : "%" + b.toString(16).toUpperCase().padStart(2, "0"))).join("");

/** requests.Session.should_strip_auth. */
function shouldStripAuth(old: URL, next: URL): boolean {
  if (old.hostname !== next.hostname) return true;
  const port = (u: URL) => u.port || (u.protocol === "https:" ? "443" : "80");
  if (old.protocol === "http:" && port(old) === "80" && next.protocol === "https:" && port(next) === "443") return false;
  return old.protocol !== next.protocol || port(old) !== port(next);
}

export class Dav {
  private base: string;
  constructor(
    address: string,
    private user: string,
    private password: string,
  ) {
    const a = address.trim();
    this.base = a.endsWith("/") ? a : `${a}/`;
  }

  /** The path part of the WebDAV root as hrefs spell it (/nc/remote.php/webdav). */
  rootPath(): string {
    const after = this.base.split("://")[1] ?? "";
    const i = after.indexOf("/");
    let p = i < 0 ? "/" : after.slice(i);
    if (!p.endsWith("/")) p += "/";
    return `${p}remote.php/webdav`;
  }

  private urlFor(p: string) {
    return `${this.base}remote.php/webdav${encodePath(p.startsWith("/") ? p : `/${p}`)}`;
  }

  /** Every hop, redirects included, is checked; credentials only to the origin they were set for. */
  private async request(method: string, p: string, depth: string | null, timeoutMs: number): Promise<Response> {
    let url = this.urlFor(p);
    let auth = true;
    for (let hop = 0; hop < 10; hop++) {
      const checked = await checkAddress(url);
      const headers: Record<string, string> = {};
      if (auth) headers.Authorization = `Basic ${Buffer.from(`${this.user}:${this.password}`).toString("base64")}`;
      if (depth) headers.Depth = depth;
      let res: Response;
      try {
        res = await fetch(checked, { method, headers, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
      } catch {
        throw new Error("Could not reach the nextcloud server. Check the server address.");
      }
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) throw new Error(`HTTP error: ${res.status}`);
        const next = new URL(loc, checked);
        if (shouldStripAuth(checked, next)) auth = false;
        url = next.toString();
        continue;
      }
      if (res.status !== 207 && !res.ok) throw Object.assign(new Error(`HTTP error: ${res.status}`), { status: res.status });
      return res;
    }
    throw new Error("Could not reach the nextcloud server. Check the server address.");
  }

  /** pyocclient list: the entries of directory `p`, without itself. */
  async list(p: string): Promise<DavEntry[]> {
    const res = await this.request("PROPFIND", p, "1", 60_000);
    return parseEntries(await res.text(), this.rootPath());
  }

  /** pyocclient get_file: stream `remote` into `local`; false when the server did not answer 200. */
  async getFile(remote: string, local: string): Promise<boolean> {
    let res: Response;
    try {
      res = await this.request("GET", remote, null, 3600_000);
    } catch (e) {
      if ((e as { status?: number }).status) return false;
      throw e;
    }
    if (res.status !== 200 || !res.body) return false;
    const out = createWriteStream(local);
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
    }
    await new Promise<void>((resolve, reject) => out.end((e?: Error | null) => (e ? reject(e) : resolve())));
    return true;
  }
}

const unescapeXml = (s: string) =>
  s.trim().replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** Every entry of a multistatus body except the listed directory itself. */
export function parseEntries(body: string, davRoot: string): DavEntry[] {
  const out: DavEntry[] = [];
  const blocks = [...body.matchAll(/<(?:[\w-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?response>/g)];
  blocks.forEach((m, i) => {
    if (i === 0) return;
    const block = m[1];
    const h = /<(?:[\w-]+:)?href\b[^>]*>([\s\S]*?)<\//.exec(block);
    if (!h) return;
    let decoded: string;
    try {
      decoded = decodeURIComponent(unescapeXml(h[1]));
    } catch {
      decoded = unescapeXml(h[1]);
    }
    const at = decoded.indexOf(davRoot);
    const ct = /<(?:[\w-]+:)?getcontenttype\b[^>]*>([\s\S]*?)<\//.exec(block);
    out.push({
      path: at >= 0 ? decoded.slice(at + davRoot.length) : decoded,
      isDir: /<(?:[\w-]+:)?collection\b/.test(block),
      contentType: ct ? unescapeXml(ct[1]) : "",
    });
  });
  return out;
}

const RAW_FORMATS = new Set(
  ".RWZ .CR2 .NRW .EIP .RAF .ERF .RW2 .NEF .ARW .K25 .DNG .SRF .DCR .RAW .CRW .BAY .3FR .CS1 .MEF .ORF .ARI .SR2 .KDC .MOS .MFW .FFF .CR3 .SRW .RWL .J6I .KC2 .X3F .MRW .IIQ .PEF .CXI .MDC".split(
    " ",
  ),
);
function extUpper(p: string): string {
  const name = p.split(/[\\/]/).pop() ?? p;
  const stem = name.replace(/^\.+/, "");
  const i = stem.lastIndexOf(".");
  return i < 0 ? "" : stem.slice(i).toUpperCase();
}

/** isValidNCMedia: images, videos, raw files and XMP sidecars. */
export function isValidMedia(e: DavEntry): boolean {
  if (e.contentType.startsWith("image/") || e.contentType.startsWith("video/")) return true;
  const ext = extUpper(e.path);
  if (RAW_FORMATS.has(ext) || ext === ".XMP") return true;
  console.info(`Skipping ${e.path}, because '${e.contentType}' is not a media type`);
  return false;
}

/** Folder nesting the scan follows (Django's recursion gives up near 1000). */
const MAX_DEPTH = 256;

/** collect_photos: every media file below `p`, depth first in listing order. */
export async function collectPhotos(dav: Dav, p: string): Promise<string[]> {
  const photos: string[] = [];
  const stack: [string, number][] = [[p, 0]];
  const seen = new Set<string>();
  while (stack.length) {
    const [dir, depth] = stack.pop()!;
    const key = dir.replace(/\/+$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    if (depth > MAX_DEPTH) throw new Error(`Nextcloud folders nest too deeply at ${dir}`);
    const subdirs: [string, number][] = [];
    for (const e of await dav.list(dir)) {
      if (e.isDir) subdirs.push([e.path, depth + 1]);
      else if (isValidMedia(e)) photos.push(e.path);
    }
    stack.push(...subdirs.reverse());
  }
  return photos;
}

/** user_media_root: PHOTOS/nextcloud_media/<username>. */
export function userMediaRoot(username: string): string {
  if (!username || username === "." || username === ".." || /[\\/]/.test(username) || path.isAbsolute(username)) {
    throw new Error(`User name ${JSON.stringify(username)} does not make a directory of its own`);
  }
  return path.join(config.photos, "nextcloud_media", username);
}

/** local_path_for: the download location of `remote`, or null when it would leave `root`. */
export function localPathFor(root: string, remote: string): string | null {
  const relative = remote.replace(/^[\\/]+/, "");
  if (!relative) return null;
  const parts: string[] = [];
  for (const part of relative.split(/[\\/]/)) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
      continue;
    }
    // Win32 drops trailing dots and spaces, so `.. ` or `...` would name the parent.
    if (path.isAbsolute(part) || (process.platform === "win32" && (part.includes(":") || /[. ]$/.test(part)))) return null;
    parts.push(part);
  }
  if (!parts.length) return null;
  const candidate = path.join(root, ...parts);
  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    return null;
  }
  let existing = candidate;
  const rest: string[] = [];
  while (!existsSync(existing)) {
    rest.push(path.basename(existing));
    const up = path.dirname(existing);
    if (up === existing) return null;
    existing = up;
  }
  const real = path.join(realpathSync(existing), ...rest.reverse());
  const rel = path.relative(realRoot, real);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? candidate : null;
}

async function download(dav: Dav, remote: string, local: string): Promise<boolean> {
  const dir = path.dirname(local);
  mkdirSync(dir, { recursive: true });
  const temp = path.join(dir, `.nextcloud-${randomUUID().replaceAll("-", "")}.part`);
  try {
    if (!(await dav.getFile(remote, temp)) || !statSync(temp, { throwIfNoEntry: false })?.isFile()) return false;
    await rename(temp, local);
    return true;
  } finally {
    await rm(temp, { force: true });
  }
}

/** The user's Nextcloud client: server address, username and the decrypted app password. */
export async function davForUser(userId: number): Promise<{ dav: Dav; user: { username: string; address: string; scanDir: string } }> {
  const [u] = await client`SELECT username, nextcloud_server_address, nextcloud_username, nextcloud_app_password, nextcloud_scan_directory
    FROM api_user WHERE id = ${userId}`;
  if (!u) throw new Error(`user ${userId} not found`);
  const password = u.nextcloud_app_password ? (decryptDjango(u.nextcloud_app_password, config.secretKey) ?? "") : "";
  return {
    dav: new Dav(u.nextcloud_server_address ?? "", u.nextcloud_username ?? "", password),
    user: { username: u.username, address: u.nextcloud_server_address ?? "", scanDir: u.nextcloud_scan_directory ?? "" },
  };
}

/** List the scan directory and download what is missing; the local paths, sorted. */
async function fetchPhotos(userId: number): Promise<string[]> {
  const { dav, user } = await davForUser(userId);
  const root = userMediaRoot(user.username);
  await checkAddress(user.address.trim());
  const photos = await collectPhotos(dav, user.scanDir);
  mkdirSync(root, { recursive: true });
  const out: string[] = [];
  for (const photo of photos) {
    const local = localPathFor(root, photo);
    if (!local) {
      console.warn(`Skipping Nextcloud file ${JSON.stringify(photo)}: it would be stored outside ${root}`);
      continue;
    }
    if (!existsSync(local)) {
      if (!(await download(dav, photo, local))) {
        console.warn(`Nextcloud did not return ${JSON.stringify(photo)}, skipping it`);
        continue;
      }
      console.info(`Downloaded photo from nextcloud to ${local}`);
    }
    out.push(local);
  }
  // Names differing only in case share one file on Windows and macOS.
  return [...new Set(out)].sort();
}

/** scan_photos: a failure anywhere fails the LongRunningJob; the job itself succeeds. */
export async function scanNextcloud(userId: number, jobId: string): Promise<void> {
  let paths: string[];
  try {
    paths = await fetchPhotos(userId);
  } catch (e) {
    console.error(`Nextcloud scan failed: ${(e as Error).message}`);
    await fail(jobId, (e as Error).message);
    return;
  }
  if (!paths.length) {
    await complete(jobId);
    try {
      await buildIndex(userId);
    } catch (e) {
      console.error(`similarity index build after the Nextcloud scan failed: ${(e as Error).message}`);
    }
    return;
  }
  // The ingest pipeline owns scanning; it reports on this LongRunningJob.
  const scan = await enqueue("scan.user", { user_id: userId, files: paths }, { lrjId: jobId });
  await enqueue("similarity.build", { user_id: userId }, { dependsOn: [scan.id] });
  console.info(`Added ${paths.length} photos`);
}

export function registerNextcloudJobs() {
  registerJob(KIND, async (ctx) => {
    const userId = Number(ctx.payload?.user_id);
    if (!Number.isInteger(userId)) throw new Error(`${KIND} payload: user_id missing`);
    const jobId = await begin(ctx.lrjId, JobType.ScanPhotos, userId);
    await scanNextcloud(userId, jobId);
  });
}
