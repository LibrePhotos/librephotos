// GET /api/dirtree/?path= (RootPathTreeView + api_util.path_to_dict): two
// levels of non-hidden subdirectories below a path inside DATA_ROOT. Port of
// lp_api::users_settings::dirtree.
import { readdirSync, statSync } from "node:fs";
import { config } from "~/lib/config";
import { json } from "~/lib/http";
import * as pypath from "./pypath";

interface Node {
  title: string;
  absolute_path: string;
  children: Node[];
}

function isHidden(p: string): boolean {
  if (pypath.basename(pypath.abspath(p)).startsWith(".")) return true;
  // Django also skips Windows FILE_ATTRIBUTE_HIDDEN folders; node:fs does not expose that bit.
  return false;
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function listSubdirectories(p: string): string[] {
  let names: string[];
  try {
    names = readdirSync(p);
  } catch (e) {
    console.warn(`Could not list directory ${p}: ${(e as Error).message}`);
    return [];
  }
  return names.map((n) => pypath.join(p, n)).filter((c) => isDir(c) && !isHidden(c));
}

function pathToDict(p: string, recurse: number): Node {
  const children = recurse > 0 ? listSubdirectories(p).map((c) => pathToDict(c, recurse - 1)) : [];
  const keyed = children.map((c) => [c.title.toLowerCase(), c] as const);
  keyed.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return { title: pypath.basename(p), absolute_path: p, children: keyed.map((k) => k[1]) };
}

export function dirtree(pathParam: string | undefined) {
  const base = config.photos;
  const p = pathParam || base;
  if (!pypath.isValidPath(p, base)) {
    return json({ message: "Access denied. Path is outside the allowed directory." }, 403);
  }
  return [pathToDict(p, 2)];
}
