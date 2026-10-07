// The os.path behaviour the Django views rely on (ntpath on Windows,
// posixpath elsewhere): scan directories are stored exactly as
// os.path.abspath spells them, and containment is api.util.is_valid_path.
// Port of lp_api::users_settings::pypath.
import { realpathSync } from "node:fs";

const WIN = process.platform === "win32";
export const SEP = WIN ? "\\" : "/";
const isSep = (c: string | undefined) => c === "/" || (WIN && c === "\\");

/** ntpath.splitdrive (drive letter or UNC share); empty on POSIX. */
function splitDrive(p: string): [string, string] {
  if (!WIN) return ["", p];
  if (p.length >= 2 && p[1] === ":" && /[A-Za-z]/.test(p[0])) return [p.slice(0, 2), p.slice(2)];
  if (p.length >= 2 && isSep(p[0]) && isSep(p[1])) {
    const rest = p.slice(2);
    const i = [...rest].findIndex((c) => isSep(c));
    if (i >= 0) {
      const after = rest.slice(i + 1);
      const jr = [...after].findIndex((c) => isSep(c));
      const j = jr >= 0 ? 2 + i + 1 + jr : p.length;
      if (j > 2 + i + 1) return [p.slice(0, j), p.slice(j)];
    }
  }
  return ["", p];
}

/** os.path.isabs (Python 3.11: on Windows a leading separator counts). */
export function isAbs(p: string): boolean {
  if (!WIN) return p.startsWith("/");
  const head = p.slice(0, 3).replace(/\//g, "\\");
  return head.startsWith("\\") || head.slice(1).startsWith(":\\");
}

/** os.path.normpath */
export function normpath(p0: string): string {
  const p = WIN ? p0.replace(/\//g, "\\") : p0;
  const [drive, rest] = splitDrive(p);
  const rooted = rest.startsWith(SEP);
  const parts: string[] = [];
  for (const comp of rest.split(SEP)) {
    if (comp === "" || comp === ".") continue;
    if (comp === "..") {
      if (parts.length && parts[parts.length - 1] !== "..") parts.pop();
      else if (!rooted) parts.push("..");
    } else parts.push(comp);
  }
  const out = drive + (rooted ? SEP : "") + parts.join(SEP);
  return out || ".";
}

/** os.path.join(a, b) */
export function join(a: string, b: string): string {
  if (isAbs(b)) return b;
  if (!a || isSep(a[a.length - 1]) || (WIN && a.endsWith(":"))) return a + b;
  return a + SEP + b;
}

/** os.path.abspath (relative paths resolve against the process CWD). */
export const abspath = (p: string) => (isAbs(p) ? normpath(p) : normpath(join(process.cwd(), p)));

/** os.path.normcase */
export const normcase = (p: string) => (WIN ? p.replace(/\//g, "\\").toLowerCase() : p);

/** os.path.basename */
export function basename(p: string): string {
  const [, rest] = splitDrive(p);
  let i = rest.length - 1;
  while (i >= 0 && !isSep(rest[i])) i--;
  return rest.slice(i + 1);
}

/** os.path.dirname */
export function dirname(p: string): string {
  const [drive, rest] = splitDrive(p);
  let i = rest.length - 1;
  while (i >= 0 && !isSep(rest[i])) i--;
  let head = i >= 0 ? rest.slice(0, i + 1) : "";
  let end = head.length;
  while (end > 0 && isSep(head[end - 1])) end--;
  if (end > 0) head = head.slice(0, end);
  return drive + head;
}

/** api.util.is_valid_path: `path` is `root` or lies inside it. */
export function isValidPath(path: string, root: string): boolean {
  const ap = normcase(abspath(path));
  const ar = normcase(abspath(root));
  if (ap === ar) return true;
  return ap.startsWith(ar.endsWith(SEP) ? ar : ar + SEP);
}

/** os.path.realpath: symlinks resolved as far as the path exists. */
export function realpath(p: string): string {
  const abs = abspath(p);
  let existing = abs;
  const tail: string[] = [];
  for (;;) {
    try {
      let out = realpathSync.native(existing);
      if (out.startsWith("\\\\?\\UNC\\")) out = "\\\\" + out.slice(8);
      else if (out.startsWith("\\\\?\\")) out = out.slice(4);
      for (const t of tail.reverse()) out = join(out, t);
      return out;
    } catch {
      const parent = dirname(existing);
      const name = basename(existing);
      if (!name || parent === existing) return abs;
      tail.push(name);
      existing = parent;
    }
  }
}

/** comparable_path: normcase(realpath(path)) */
export const comparable = (p: string) => normcase(realpath(p));

/** directories_overlap */
export function overlap(one: string, other: string): boolean {
  const a = comparable(one);
  const b = comparable(other);
  return isValidPath(a, b) || isValidPath(b, a);
}
