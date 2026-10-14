import { call } from "./client";
import { REF_URL } from "./env";
import { manifest, type Username } from "./manifest";

/**
 * The scan directory `user` has on the server. Not the manifest's: on a clone
 * with its own media copy (clone_db.sh <db> <media_dir>) it points into the copy.
 */
export async function scanDirectory(user: Username, baseUrl = REF_URL): Promise<string> {
  const res = await call<{ scan_directory: string }>(user, { path: `/api/user/${manifest().users[user].id}/` }, baseUrl);
  if (res.status !== 200) throw new Error(`${baseUrl}: GET own user as ${user} answered ${res.status}`);
  return res.body.scan_directory;
}

/** The photos root (DATA_ROOT) on the server: every fixture user's tree sits right under it. */
export async function photosRoot(baseUrl = REF_URL): Promise<string> {
  const dir = await scanDirectory("alice", baseUrl);
  return dir.slice(0, Math.max(dir.lastIndexOf("\\"), dir.lastIndexOf("/")));
}
