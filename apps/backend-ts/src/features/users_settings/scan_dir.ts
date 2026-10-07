// Library roots: normalize_scan_directory, the overlap rule (#2034) and
// auto_create_user_directory from api/serializers/user.py. Port of
// lp_api::users_settings::scan_dir.
import { existsSync, lstatSync, mkdirSync, statSync } from "node:fs";
import { config } from "~/lib/config";
import { ApiError } from "~/lib/errors";
import { siteSettings } from "~/lib/settings";
import { otherScanDirectories, setScanDirectory } from "./db";
import * as pypath from "./pypath";

const dataRoot = () => config.photos;

/** reject_overlap_with_another_user; `user` is the account being edited. */
async function rejectOverlap(absDir: string, user: { id: number; scan_directory: string } | null) {
  if (user && user.scan_directory && pypath.comparable(absDir) === pypath.comparable(user.scan_directory)) return;
  const others = await otherScanDirectories(user?.id ?? null);
  const other = others.find((o) => pypath.overlap(absDir, o.scan_directory));
  if (other) {
    throw ApiError.validation(
      `Scan directory overlaps the library of user '${other.username}' (${other.scan_directory}). Every photo has exactly one owner, so two users cannot scan the same files.`,
    );
  }
}

/** normalize_scan_directory: null when nothing was supplied. */
export async function normalizeScanDirectory(dir: string, user: { id: number; scan_directory: string } | null): Promise<string | null> {
  if (!dir) return null;
  const abs = pypath.abspath(dir);
  if (!pypath.isValidPath(abs, dataRoot())) throw ApiError.validation("Scan directory must be inside the data root.");
  if (!existsSync(abs)) throw ApiError.validation("Scan directory does not exist");
  await rejectOverlap(abs, user);
  return abs;
}

/** auto_create_user_directory: never fails the caller, refusals are logged. */
export async function autoCreateUserDirectory(user: { id: number; username: string; scan_directory: string }, claimExisting: boolean) {
  if (!(await siteSettings()).AUTO_CREATE_USER_DIRECTORY || user.scan_directory) return;
  const refuse = (reason: string) =>
    console.warn(
      `Not creating a data folder for user ${user.username}: ${reason}. The account was created without a scan directory; assign one in the Admin Area.`,
    );
  const root = pypath.abspath(dataRoot());
  const candidate = pypath.abspath(pypath.join(root, user.username));
  if (pypath.dirname(candidate) !== root) return refuse(`the username does not name a folder directly inside ${root}`);
  try {
    await rejectOverlap(candidate, user);
  } catch (e) {
    return refuse(`${candidate} is not available. ${e instanceof ApiError ? (e.errors[0]?.message ?? "") : String(e)}`);
  }
  let exists = true;
  try {
    lstatSync(candidate);
  } catch {
    exists = false;
  }
  if (exists) {
    if (!claimExisting) {
      return refuse(
        `${candidate} already exists and may hold someone else's photos, so it is not handed to a self-registered or single sign-on account`,
      );
    }
    try {
      if (!statSync(candidate).isDirectory()) return refuse(`${candidate} exists but is not a directory`);
    } catch {
      return refuse(`${candidate} exists but is not a directory`);
    }
  } else {
    try {
      mkdirSync(pypath.dirname(candidate), { recursive: true });
      mkdirSync(candidate);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "EEXIST" && !claimExisting) return refuse(`${candidate} was created by something else meanwhile`);
      if (code !== "EEXIST") return refuse(`could not create ${candidate}: ${(e as Error).message}`);
    }
  }
  try {
    await setScanDirectory(user.id, candidate);
  } catch (e) {
    console.error("could not store the new scan directory", e);
    return;
  }
  console.info(`Assigned data folder ${candidate} to user ${user.username}`);
}
