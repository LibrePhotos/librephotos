/**
 * Real {@link AssetHasher} backed by expo-file-system (SDK 57 `legacy` entry).
 * Computes the raw md5 hex of an asset's bytes via `getInfoAsync(uri,
 * { md5: true })`. `ph://` assets (iOS) aren't directly readable, so they're
 * resolved to a `localUri` via `MediaLibrary.getAssetInfoAsync` first.
 *
 * App-only: imported solely by sync/run.
 */
import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library/legacy";
import type { AssetHasher, LocalMediaType } from "./types";

async function readableUri(id: string, uri: string): Promise<string | null> {
  if (!uri.startsWith("ph://")) return uri;
  // iOS PhotoKit asset: resolve to a readable file uri (may download from iCloud).
  const info = await MediaLibrary.getAssetInfoAsync(id, { shouldDownloadFromNetwork: true });
  return info.localUri ?? null;
}

export function createExpoAssetHasher(): AssetHasher {
  return {
    async md5(asset: { id: string; uri: string; type: LocalMediaType }): Promise<string | null> {
      const uri = await readableUri(asset.id, asset.uri);
      if (!uri) return null;
      const info = await FileSystem.getInfoAsync(uri, { md5: true });
      if (!info.exists) return null;
      return info.md5 ?? null;
    },
  };
}
