import { useEffect, useMemo } from "react";
import { Photo, usePhotoDetailsQuery } from "@librephotos/api-client";
import { useDb } from "@/db/provider";
import { getPhotoDetail, putPhotoDetail, remotePhotoIdByHash } from "@/db/queries/detail";

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
  const photoId = useMemo(
    () => (imageHash ? remotePhotoIdByHash(db, imageHash) : null),
    [db, imageHash]
  );

  const cached = useMemo<Photo | null>(() => {
    if (!photoId) return null;
    const row = getPhotoDetail(db, photoId);
    if (!row) return null;
    const parsed = Photo.safeParse(JSON.parse(row.payload));
    return parsed.success ? parsed.data : null;
  }, [db, photoId]);

  const query = usePhotoDetailsQuery(imageHash);

  useEffect(() => {
    if (query.data && photoId) {
      putPhotoDetail(db, photoId, JSON.stringify(query.data), Date.now());
    }
  }, [db, photoId, query.data]);

  const detail = query.data ?? cached;
  return {
    detail: detail ?? null,
    isLoading: query.isLoading && !cached,
    isError: query.isError && !cached,
    fromCache: !query.data && !!cached,
  };
}
