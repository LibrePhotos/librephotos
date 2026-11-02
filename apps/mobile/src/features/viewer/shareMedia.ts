/**
 * "Share" in the viewer: hand the photo or video to another app through the
 * system share sheet (expo-sharing, bundled in Expo Go).
 *
 * A phone copy (camera roll) is shared as is: no network, works offline. A
 * server-only item is first fetched with the user's token into the cache, the
 * same way "Save to device" fetches originals, because the share sheet only
 * takes local files.
 *
 * The cache folder is emptied at the start of the next share rather than right
 * after this one: on Android `shareAsync` resolves before the receiving app has
 * read the file, and deleting it then would hand that app nothing.
 */
import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library/legacy";
import * as Sharing from "expo-sharing";
import { mediaHeaders, photoUrl } from "@librephotos/api-client";
import { extensionForMime } from "@/features/selection/saveToDevice";

export type ShareTarget =
  /** On this phone: `uri` is the asset's `file://`, `ph://` or `content://` uri. */
  | { kind: "local"; localId: string | null; uri: string }
  /** Only on the server; `filename` is the original's name when the details know it. */
  | { kind: "remote"; imageHash: string; filename: string | null };

export type ShareResult = "shared" | "unavailable" | "failed";

export type ShareArgs = {
  target: ShareTarget;
  serverAddress: string;
  accessToken: string | null;
  dialogTitle?: string;
};

/** The share sheet takes `file://` only; a `ph://` (iOS) or `content://` asset is resolved first. */
async function localFileUri(target: Extract<ShareTarget, { kind: "local" }>): Promise<string | null> {
  if (target.uri.startsWith("file://")) return target.uri;
  if (!target.localId) return null;
  const info = await MediaLibrary.getAssetInfoAsync(target.localId, { shouldDownloadFromNetwork: true });
  return info.localUri ?? null;
}

/** The response's Content-Type, whatever case the platform gave the header. */
function contentType(result: FileSystem.FileSystemDownloadResult): string | null {
  if (result.mimeType) return result.mimeType;
  const key = Object.keys(result.headers).find((k) => k.toLowerCase() === "content-type");
  return key ? (result.headers[key] ?? null) : null;
}

/** `IMG_0001.JPG` → `{ stem: "IMG_0001", extension: "JPG" }`, made safe for a file name. */
export function splitFilename(filename: string | null): { stem: string | null; extension: string | null } {
  if (!filename) return { stem: null, extension: null };
  const safe = filename.replace(/[^\w.\- ]/g, "_");
  const dot = safe.lastIndexOf(".");
  if (dot <= 0) return { stem: safe || null, extension: null };
  return { stem: safe.slice(0, dot), extension: safe.slice(dot + 1) || null };
}

/** Fetch a server original into `dir`, named so the receiving app knows what it is. */
async function downloadForShare(
  args: ShareArgs,
  target: Extract<ShareTarget, { kind: "remote" }>,
  dir: string
): Promise<{ uri: string; mimeType: string | null } | null> {
  const partial = `${dir}${target.imageHash}`;
  const result = await FileSystem.downloadAsync(photoUrl(args.serverAddress, target.imageHash), partial, {
    headers: mediaHeaders(args.accessToken),
  });
  if (result.status !== 200) return null;
  const mimeType = contentType(result);
  const { stem, extension: nameExtension } = splitFilename(target.filename);
  // The served type names the format best; a RAW comes as `image/x-dcraw`, so
  // its own file name is the only hint of what it is.
  const extension = extensionForMime(mimeType) ?? nameExtension;
  const named = `${dir}${stem ?? target.imageHash}${extension ? `.${extension}` : ""}`;
  if (named !== partial) await FileSystem.moveAsync({ from: partial, to: named });
  return { uri: named, mimeType: mimeType?.split(";")[0]?.trim() ?? null };
}

/** Open the system share sheet for one photo or video. */
export async function shareMedia(args: ShareArgs): Promise<ShareResult> {
  if (!(await Sharing.isAvailableAsync())) return "unavailable";
  try {
    if (args.target.kind === "local") {
      const uri = await localFileUri(args.target);
      if (!uri) return "failed";
      await Sharing.shareAsync(uri, { dialogTitle: args.dialogTitle });
      return "shared";
    }

    const cache = FileSystem.cacheDirectory;
    if (!cache) return "failed";
    const dir = `${cache}share/`;
    // Whatever the last share left for its receiving app is done with by now.
    await FileSystem.deleteAsync(dir, { idempotent: true });
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    const file = await downloadForShare(args, args.target, dir);
    if (!file) return "failed";
    await Sharing.shareAsync(file.uri, { mimeType: file.mimeType ?? undefined, dialogTitle: args.dialogTitle });
    return "shared";
  } catch {
    return "failed";
  }
}
