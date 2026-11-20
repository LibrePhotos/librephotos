import { useEffect, useMemo } from "react";
import { Photo, usePhotoDetailsQuery } from "@librephotos/api-client";
import { useDb, useReactiveQuery } from "@/db/provider";
import { parseJson } from "@/lib/guards";
import { getPhotoDetail, putPhotoDetail, remotePhotoIdByHash } from "@librephotos/local-db";

export type PhotoDetailState = {
  detail: Photo | null;
  isLoading: boolean;
  isError: boolean;
  fromCache: boolean;
};

/**
 * Cache-then-network photo detail. Reads the cached payload from
 * remote_photo_detail first (instant), fires the network fetch via api-client,
 * and writes the fresh payload back to the cache on success.
 */
export function usePhotoDetail(imageHash: string | undefined): PhotoDetailState {
  const db = useDb();
  // The cached payload, from the live-query cache when this photo was open before.
  const { data: cachedRow } = useReactiveQuery(
    ["photo-detail-cache", imageHash ?? null],
    async (d) => {
      const photoId = imageHash ? await remotePhotoIdByHash(d, imageHash) : null;
      const row = photoId ? await getPhotoDetail(d, photoId) : null;
      return photoId ? { photoId, payload: row?.payload ?? null } : null;
    },
    null,
    { tables: ["remote_photo", "remote_photo_detail"] }
  );
  const photoId = cachedRow?.photoId ?? null;

  const cached = useMemo<Photo | null>(() => {
    if (!cachedRow?.payload) return null;
    const parsed = Photo.safeParse(parseJson(cachedRow.payload));
    return parsed.success ? parsed.data : null;
  }, [cachedRow]);

  const query = usePhotoDetailsQuery(imageHash);

  useEffect(() => {
    if (query.data && photoId) void putPhotoDetail(db, photoId, JSON.stringify(query.data), Date.now());
  }, [db, photoId, query.data]);

  const detail = query.data ?? cached;
  return {
    detail: detail ?? null,
    isLoading: query.isLoading && !cached,
    isError: query.isError && !cached,
    fromCache: !query.data && !!cached,
  };
}
