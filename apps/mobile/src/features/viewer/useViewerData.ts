import { useSiteSettingsQuery } from "@librephotos/api-client";
import { useReactiveQuery } from "@/db/provider";
import {
  albumsContainingPhoto,
  localAssetById,
  photoFlagsByHash,
  photoSummaryByHash,
  type PhotoAlbumRow,
  type PhotoFlags,
  type PhotoSummary,
  type ViewerSlide,
} from "@/db/queries/detail";
import { usePhotoDetail } from "./usePhotoDetail";

/**
 * Everything the viewer shows about the active slide: the mirror's rows, the
 * camera-roll asset, and the server's detail payload.
 *
 * `ready` is `useAfterFirstPaint`: the album rows and the detail payload are
 * sheet content, never first-frame content.
 */
export function useViewerData(current: ViewerSlide | undefined, ready: boolean) {
  const hash = current?.image_hash ?? null;
  const localId = current?.local_id ?? null;
  // Server-side rows exist only for photos the server knows about; a local-only
  // asset gets its metadata from the camera roll instead.
  const flags = useReactiveQuery<PhotoFlags | null>((d) => (hash ? photoFlagsByHash(d, hash) : null), [hash]);
  const summary = useReactiveQuery<PhotoSummary | null>((d) => (hash ? photoSummaryByHash(d, hash) : null), [hash]);
  const local = useReactiveQuery((d) => (localId ? localAssetById(d, localId) : null), [localId]);
  // Album membership is sheet content, never first-frame content: a two-table
  // UNION for a surface the user has not opened yet.
  const albums = useReactiveQuery<PhotoAlbumRow[]>(
    (d) => (ready && summary ? albumsContainingPhoto(d, summary.id) : []),
    [ready, summary?.id]
  );

  // Deferred: this reads the cached payload off disk and runs it through zod,
  // then fetches over the network. None of that belongs in a mount render.
  const detail = usePhotoDetail(ready && flags && hash ? hash : undefined);
  // Site settings decide whether the server wants maps shown at all — the same
  // `map_tile_provider === "none"` switch the web frontend honours.
  const settings = useSiteSettingsQuery();
  const mapsDisabled = settings.data?.map_tile_provider === "none";

  const timestamp = summary?.timestamp ?? local?.created_at ?? null;
  return { hash, flags, summary, local, albums, detail, mapsDisabled, timestamp };
}
