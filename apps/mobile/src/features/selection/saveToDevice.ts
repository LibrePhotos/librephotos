/**
 * "Save to phone" for a grid selection (Google Photos' "Save to device"): fetch
 * each server original with the user's token into the cache, then hand it to
 * the gallery through expo-media-library. One file at a time, so a big selection
 * never holds more than one original on disk, and one failure (a RAW the gallery
 * refuses, a 404) only costs that photo.
 *
 * Both expo modules come from their SDK 57 `legacy` entries, like the rest of
 * the app (Expo Go ships them).
 */
import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library/legacy";
import { mediaHeaders, photoUrl } from "@librephotos/api-client";

/**
 * The file extension the gallery needs to recognise a file, by the type the
 * server sends the original with (`/media/photos/<hash>` answers with the real
 * type, #2742). A type missing here is one no phone gallery takes (camera RAW
 * comes as `image/x-dcraw` with no hint of its real format), so it is not saved.
 */
const EXTENSIONS: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/avif": "avif",
  "image/tiff": "tiff",
  "image/bmp": "bmp",
  "image/dng": "dng",
  "image/x-adobe-dng": "dng",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/x-m4v": "m4v",
  "video/3gpp": "3gp",
  "video/webm": "webm",
  "video/x-matroska": "mkv",
};

/** `image/jpeg; charset=…` → `jpg`; null for a type the gallery would not take. */
export function extensionForMime(mime: string | null | undefined): string | null {
  if (!mime) return null;
  const type = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  return EXTENSIONS[type] ?? null;
}

/** The response's Content-Type, whatever case the platform gave the header. */
function contentType(result: FileSystem.FileSystemDownloadResult): string | null {
  if (result.mimeType) return result.mimeType;
  const key = Object.keys(result.headers).find((k) => k.toLowerCase() === "content-type");
  return key ? (result.headers[key] ?? null) : null;
}

export type SaveToDeviceResult =
  /** The user did not let the app add to the gallery: nothing was fetched. */
  | { kind: "permissionDenied" }
  | { kind: "done"; saved: number; failed: number };

export type SaveToDeviceArgs = {
  imageHashes: string[];
  serverAddress: string;
  accessToken: string | null;
};

/** Ask for add-to-gallery access (write only: the app reads nothing here). */
async function ensureWritePermission(): Promise<boolean> {
  const granular: MediaLibrary.GranularPermission[] = ["photo", "video"];
  const current = await MediaLibrary.getPermissionsAsync(true, granular);
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const asked = await MediaLibrary.requestPermissionsAsync(true, granular);
  return asked.granted;
}

let runSeq = 0;

/** Download one original and add it to the gallery; true when it got there. */
async function saveOne(args: SaveToDeviceArgs, imageHash: string, dir: string): Promise<boolean> {
  const partial = `${dir}${imageHash}`;
  let named: string | null = null;
  try {
    const result = await FileSystem.downloadAsync(photoUrl(args.serverAddress, imageHash), partial, {
      headers: mediaHeaders(args.accessToken),
    });
    if (result.status !== 200) return false;
    const extension = extensionForMime(contentType(result));
    if (!extension) return false;
    // The gallery tells a photo from a video by the file's extension.
    named = `${partial}.${extension}`;
    await FileSystem.moveAsync({ from: partial, to: named });
    await MediaLibrary.saveToLibraryAsync(named);
    return true;
  } catch {
    return false;
  } finally {
    await FileSystem.deleteAsync(partial, { idempotent: true }).catch(() => undefined);
    if (named) await FileSystem.deleteAsync(named, { idempotent: true }).catch(() => undefined);
  }
}

/**
 * Save the originals of `imageHashes` to the phone's gallery. Callers pass only
 * server photos that are not on the phone already (`selectedDownloadableHashes`).
 */
export async function saveToDevice(args: SaveToDeviceArgs): Promise<SaveToDeviceResult> {
  if (!(await ensureWritePermission())) return { kind: "permissionDenied" };
  const cache = FileSystem.cacheDirectory;
  if (!cache) return { kind: "done", saved: 0, failed: args.imageHashes.length };

  // A directory per run, so two runs over the same photo never share a file.
  const dir = `${cache}save-to-device/${Date.now()}-${++runSeq}/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });

  let saved = 0;
  let failed = 0;
  try {
    for (const hash of args.imageHashes) {
      if (await saveOne(args, hash, dir)) saved += 1;
      else failed += 1;
    }
  } finally {
    await FileSystem.deleteAsync(dir, { idempotent: true }).catch(() => undefined);
  }
  return { kind: "done", saved, failed };
}
