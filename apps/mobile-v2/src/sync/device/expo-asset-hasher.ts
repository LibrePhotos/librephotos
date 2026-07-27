/**
 * Real {@link AssetHasher} / {@link AssetMaterializer} backed by
 * expo-file-system (SDK 54 `legacy` entry) + expo-media-library.
 *
 * ## Why this file is careful about the network
 *
 * Computing `md5(bytes)` over a 3 MB photo is tens of milliseconds. On a real
 * iPhone the "Preparing photos" step was measured at **~1.8 s per photo** —
 * fifty times that — because every `ph://` asset was resolved with
 * `getAssetInfoAsync(id, { shouldDownloadFromNetwork: true })`. With iCloud
 * Photos + "Optimise iPhone Storage" (the default once a library outgrows the
 * device) most originals are *not* on the phone, so each hash silently
 * downloaded a multi-megabyte original before a single byte was hashed. Hashing
 * was never the bottleneck; fetching the bytes was.
 *
 * So `hash()` asks with `shouldDownloadFromNetwork: false`. iOS then answers
 * immediately with either a `localUri` (hash it at full speed) or
 * `isNetworkAsset: true` and no uri — which this module reports as
 * `{ status: "remote" }` rather than paying for the download. See
 * `MediaLibraryModule.swift` `resolveImage`: `isNetworkAsset` is populated *only*
 * when `shouldDownloadFromNetwork` is false, which is exactly the call we make.
 *
 * `materialize()` is the deliberate exception — the single place that may pull
 * an original down — and it returns the md5 of what it fetched so the upload
 * path never pays for the same bytes twice.
 *
 * App-only: imported solely by sync/run.
 */
import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library";
import type {
  AssetHasher,
  AssetHashResult,
  AssetMaterializer,
  HashableAsset,
  MaterializedAsset,
} from "./types";

/** What a no-network resolve of a `ph://` asset can tell us. */
type Resolved =
  | { kind: "local"; uri: string }
  /** Bytes are in iCloud; getting them means a download. */
  | { kind: "remote" }
  | { kind: "unavailable" };

/**
 * Resolve an asset to a readable uri **without allowing a network fetch**.
 *
 * Non-`ph://` uris (Android `file://`) are already readable. For `ph://` we ask
 * PhotoKit for a content-editing input with network access denied: a local
 * asset yields `localUri` in a millisecond or two, an iCloud-only asset yields
 * no uri and `isNetworkAsset: true`.
 */
async function resolveLocal(id: string, uri: string): Promise<Resolved> {
  if (!uri.startsWith("ph://")) return { kind: "local", uri };
  const info = await MediaLibrary.getAssetInfoAsync(id, { shouldDownloadFromNetwork: false });
  if (info.localUri) return { kind: "local", uri: info.localUri };
  // No uri and the flag says "in the cloud" — deferrable. A missing flag (a
  // platform that does not report it) is also treated as deferrable rather than
  // permanently unreadable: deferral is recoverable, a permanent skip is not,
  // and the upload queue's attempt cap bounds the retries either way.
  return info.isNetworkAsset === false ? { kind: "unavailable" } : { kind: "remote" };
}

/** md5 the file at `uri`, or null when it isn't there. */
async function md5Of(uri: string): Promise<string | null> {
  const info = await FileSystem.getInfoAsync(uri, { md5: true });
  if (!info.exists) return null;
  return info.md5 ?? null;
}

export function createExpoAssetHasher(): AssetHasher & AssetMaterializer {
  return {
    async hash(asset: HashableAsset): Promise<AssetHashResult> {
      const resolved = await resolveLocal(asset.id, asset.uri);
      if (resolved.kind === "remote") return { status: "remote" };
      if (resolved.kind === "unavailable") return { status: "unavailable" };
      const md5 = await md5Of(resolved.uri);
      return md5 ? { status: "hashed", md5 } : { status: "unavailable" };
    },

    /**
     * Download-if-needed, then checksum. The ONE call in the app that may pull
     * bytes over the network for hashing purposes, and it only runs from the
     * upload path — i.e. behind the backup toggle and the Wi-Fi/charging gate.
     */
    async materialize(asset: HashableAsset): Promise<MaterializedAsset | null> {
      let uri = asset.uri;
      if (uri.startsWith("ph://")) {
        const info = await MediaLibrary.getAssetInfoAsync(asset.id, {
          shouldDownloadFromNetwork: true,
        });
        if (!info.localUri) return null;
        uri = info.localUri;
      }
      const md5 = await md5Of(uri);
      return md5 ? { uri, md5 } : null;
    },
  };
}
