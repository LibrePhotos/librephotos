// GET /api/media/diagnostics/{fname} (admins): why the web server could not
// read an original. Port of MediaPermissionDiagnosticsView and
// api/serving_permissions.py (diagnose_media_path), via lp_media::diagnostics.
import { readFileSync, statSync } from "node:fs";
import { config } from "~/lib/config";
import { json } from "~/lib/http";
import { mainFilePath, type PhotoKey } from "./queries";
import { dirname } from "./pyfmt";

const WIN = process.platform === "win32";
const MOUNT_OPTION_FILESYSTEMS = ["cifs", "smbfs", "smb3", "vfat", "msdos", "exfat", "ntfs", "ntfs3", "fuseblk", "iso9660", "udf", "sshfs", "fuse.sshfs"];
const NETWORK_FILESYSTEMS = ["nfs", "nfs4", "cifs", "smbfs", "smb3", "sshfs", "fuse.sshfs"];

/** The uid/gid nginx serves originals as (WEBSERVER_UID / WEBSERVER_GID). */
function webserverIds(): [number, number] {
  const get = (k: string) => {
    const v = process.env[k]?.trim() ?? "";
    return /^\+?\d+$/.test(v) && Number(v) <= 0xffffffff ? Number(v) : 101;
  };
  return [get("WEBSERVER_UID"), get("WEBSERVER_GID")];
}

interface Stat {
  mode: number;
  uid: number;
  gid: number;
}

type StatResult = { ok: Stat } | { err: "missing" | "other" };

/**
 * What os.stat reports, as far as the diagnosis uses it. On Windows this is
 * CPython's emulation: mode bits from the read-only attribute, directories
 * and .exe/.bat/.cmd/.com executable, uid/gid 0.
 */
function stat(p: string): StatResult {
  try {
    const st = statSync(p);
    if (!WIN) return { ok: { mode: st.mode, uid: st.uid, gid: st.gid } };
    let mode = (st.mode & 0o200) === 0 ? 0o444 : 0o666;
    if (st.isDirectory()) mode |= 0o040000 | 0o111;
    else {
      mode |= 0o100000;
      const lower = p.toLowerCase();
      if ([".exe", ".bat", ".cmd", ".com"].some((e) => lower.endsWith(e))) mode |= 0o111;
    }
    return { ok: { mode, uid: 0, gid: 0 } };
  } catch (e) {
    return { err: (e as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "other" };
  }
}

/** _permits: owner class, else group class, else other; no fall-through. */
function permits(st: Stat, uid: number, gid: number, userBit: number, groupBit: number, otherBit: number): boolean {
  if (st.uid === uid) return (st.mode & userBit) !== 0;
  if (st.gid === gid) return (st.mode & groupBit) !== 0;
  return (st.mode & otherBit) !== 0;
}

function collapse(parts: string[], absolute: boolean): string[] {
  const out: string[] = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") {
      if (out.length && out[out.length - 1] !== "..") out.pop();
      else if (!absolute) out.push("..");
    } else out.push(p);
  }
  return out;
}

function normpathPosix(p: string): string {
  if (p === "") return ".";
  const lead = p.startsWith("//") && !p.startsWith("///") ? "//" : p.startsWith("/") ? "/" : "";
  const out = lead + collapse(p.split("/"), lead !== "").join("/");
  return out === "" ? "." : out;
}

function normpathNt(path: string): string {
  const p = path.replace(/\//g, "\\");
  const [drive, rest] = p.length >= 2 && p[1] === ":" ? [p.slice(0, 2), p.slice(2)] : ["", p];
  const root = rest.startsWith("\\") ? "\\" : "";
  const out = drive + root + collapse(rest.split("\\"), root !== "").join("\\");
  return out === "" ? "." : out;
}

/** os.path.normpath. */
export const normpath = (p: string) => (WIN ? normpathNt(p) : normpathPosix(p));

/** _ancestors: every directory above path, outermost first. */
function ancestors(p: string): string[] {
  let parent = dirname(normpath(p));
  const chain: string[] = [];
  for (;;) {
    chain.push(parent);
    const next = dirname(parent);
    if (next === parent || next === "") break;
    parent = next;
  }
  return chain.reverse();
}

const unescapeMountField = (v: string) =>
  v.replaceAll("\\040", " ").replaceAll("\\011", "\t").replaceAll("\\012", "\n").replaceAll("\\134", "\\");

interface Mount {
  point: string;
  kind: string;
  options: string[];
}

function readMounts(): Mount[] {
  let text: string;
  try {
    text = readFileSync("/proc/mounts", "utf8");
  } catch {
    return [];
  }
  const out: Mount[] = [];
  for (const line of text.split("\n")) {
    const f = line.split(/\s+/).filter(Boolean);
    if (f.length >= 4) out.push({ point: unescapeMountField(f[1]!), kind: f[2]!, options: f[3]!.split(",") });
  }
  return out;
}

interface MountInfo {
  point: string;
  type: string;
  options: string[];
  read_only: boolean;
  permissions_from_mount: boolean;
  network: boolean;
}

/** describe_mount: the mount entry with the longest matching point. */
function describeMount(path: string): MountInfo | null {
  const p = normpath(path);
  let best: Mount | undefined;
  for (const m of readMounts()) {
    const point = normpath(m.point);
    const inside = p === point || p.startsWith(`${point.replace(/\/+$/, "")}/`) || point === "/";
    if (inside && (!best || point.length > normpath(best.point).length)) best = m;
  }
  if (!best) return null;
  return {
    point: best.point,
    type: best.kind,
    options: best.options,
    read_only: best.options.includes("ro"),
    permissions_from_mount: MOUNT_OPTION_FILESYSTEMS.includes(best.kind),
    network: NETWORK_FILESYSTEMS.includes(best.kind),
  };
}

type Blocking = { path: string; kind: string; mode?: string; uid?: number; gid?: number } | null;

const describeComponent = (path: string, st: Stat, kind: string): Blocking => ({
  path,
  kind,
  mode: (st.mode & 0o7777).toString(8).padStart(4, "0"),
  uid: st.uid,
  gid: st.gid,
});

/** _remedies. */
function remedies(cause: string, blocking: Blocking, mount: MountInfo | null, dataRoot: string): string[] {
  if (cause === "not_mode_bits") return ["labels"];
  if (cause !== "mode_bits") return [];
  const out: string[] = [];
  if (blocking) {
    const bp = normpath(blocking.path);
    if (bp === normpath(dataRoot) || bp === "/") out.push("mount_deeper");
  }
  if (mount?.read_only) out.push("read_only");
  if (mount?.permissions_from_mount) out.push("mount_options");
  else if (mount?.network) out.push("network_fs");
  else out.push("chmod");
  if (mount?.network && !out.includes("network_fs")) out.push("network_fs");
  return out;
}

const S_IXUSR = 0o100;
const S_IXGRP = 0o010;
const S_IXOTH = 0o001;
const S_IRUSR = 0o400;
const S_IRGRP = 0o040;
const S_IROTH = 0o004;

/** diagnose_media_path. */
export function diagnoseMediaPath(rawPath: string, dataRoot: string) {
  const [uid, gid] = webserverIds();
  const path = normpath(rawPath);
  const mount = describeMount(path);
  const result = (exists: boolean, readable: boolean, cause: string, blocking: Blocking, rem: string[]) => ({
    path,
    exists,
    readable_by_webserver: readable,
    cause,
    blocking,
    webserver: { uid, gid },
    mount,
    remedies: rem,
  });

  for (const directory of ancestors(path)) {
    const s = stat(directory);
    if ("err" in s) {
      const blocking = { path: directory, kind: "directory" };
      if (s.err === "missing") return result(false, false, "missing", blocking, []);
      return result(true, false, "not_mode_bits", blocking, remedies("not_mode_bits", blocking, mount, dataRoot));
    }
    if (!permits(s.ok, uid, gid, S_IXUSR, S_IXGRP, S_IXOTH)) {
      const blocking = describeComponent(directory, s.ok, "directory");
      return result(true, false, "mode_bits", blocking, remedies("mode_bits", blocking, mount, dataRoot));
    }
  }

  const s = stat(path);
  if ("err" in s) {
    const blocking = { path, kind: "file" };
    if (s.err === "missing") return result(false, false, "missing", blocking, []);
    return result(true, false, "not_mode_bits", blocking, remedies("not_mode_bits", blocking, mount, dataRoot));
  }
  if (!permits(s.ok, uid, gid, S_IRUSR, S_IRGRP, S_IROTH)) {
    const blocking = describeComponent(path, s.ok, "file");
    return result(true, false, "mode_bits", blocking, remedies("mode_bits", blocking, mount, dataRoot));
  }
  return result(true, true, "not_mode_bits", null, remedies("not_mode_bits", null, mount, dataRoot));
}

/** _get_photo_filter_kwargs: a valid UUID addresses the pk, anything else the hash. */
function photoKey(value: string): PhotoKey {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return { id: value.toLowerCase() };
  return { hash: value };
}

export async function diagnostics(fname: string): Promise<Response | object> {
  const main = await mainFilePath(photoKey(fname));
  if (main === undefined) return json({ detail: "No photo matches that identifier." }, 404);
  if (main === null) {
    return { path: null, exists: false, readable_by_webserver: false, cause: "missing", blocking: null, remedies: [] };
  }
  return diagnoseMediaPath(main, config.photos);
}
