/**
 * Real {@link MediaProvider} backed by expo-media-library (SDK 54 main entry —
 * the stable getAssetsAsync/getAlbumsAsync API; the rewritten API lives behind
 * `expo-media-library/next` here and only becomes the default in later SDKs).
 * App-only: imported solely by sync/run, never by the pure device-sync module
 * or the Node tests.
 */
import * as MediaLibrary from "expo-media-library";
import type {
  LocalMediaType,
  MediaAlbum,
  MediaAsset,
  MediaPage,
  MediaPermission,
  MediaProvider,
  MediaQuery,
} from "./types";

function mapType(t: MediaLibrary.MediaTypeValue): LocalMediaType {
  return t === "video" || t === "pairedVideo" ? "video" : "image";
}

function mapAsset(a: MediaLibrary.Asset): MediaAsset {
  return {
    id: a.id,
    filename: a.filename,
    uri: a.uri,
    type: mapType(a.mediaType),
    width: a.width,
    height: a.height,
    creationTime: a.creationTime,
    modificationTime: a.modificationTime,
    duration: a.duration,
  };
}

function mapPermission(p: MediaLibrary.PermissionResponse): MediaPermission {
  const access = p.accessPrivileges ?? (p.granted ? "all" : "none");
  return { granted: p.granted, canAskAgain: p.canAskAgain, accessPrivileges: access };
}

export function createExpoMediaProvider(): MediaProvider {
  return {
    async getPermissions() {
      return mapPermission(await MediaLibrary.getPermissionsAsync());
    },
    async requestPermissions() {
      return mapPermission(await MediaLibrary.requestPermissionsAsync());
    },
    async getAlbums() {
      // `includeSmartAlbums` is deliberately OFF. iOS returns ~20 overlapping
      // smart albums (Recents, Favorites, Screenshots, Selfies, Live Photos, …)
      // whose assets are almost entirely the same photos; enumerating each one
      // made the first sync O(albums × assets) and froze the app on a real
      // device. The whole library is covered once by the synthetic
      // LIBRARY_ALBUM_ID pass in media-sync, so only user-created albums (which
      // is what per-album backup selection is actually for) are needed here.
      // The `isSmart` flag below is a second line of defence for platforms that
      // report smart albums anyway.
      const albums = await MediaLibrary.getAlbumsAsync({ includeSmartAlbums: false });
      return albums.map(
        (al): MediaAlbum => ({
          id: al.id,
          title: al.title,
          assetCount: al.assetCount,
          isSmart: al.type === "smartAlbum",
        })
      );
    },
    async getAssets(query: MediaQuery): Promise<MediaPage> {
      const page = await MediaLibrary.getAssetsAsync({
        first: query.first,
        after: query.after,
        album: query.albumId,
        createdAfter: query.createdAfter,
        mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
        sortBy: [[MediaLibrary.SortBy.creationTime, query.ascending ?? false]],
      });
      return {
        assets: page.assets.map(mapAsset),
        endCursor: page.endCursor,
        hasNextPage: page.hasNextPage,
        totalCount: page.totalCount,
      };
    },
    addChangeListener(listener: () => void) {
      return MediaLibrary.addListener(() => listener());
    },
  };
}
