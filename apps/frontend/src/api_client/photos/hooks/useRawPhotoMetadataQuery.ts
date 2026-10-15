import { endpoints, photoKeys } from "@librephotos/api-client";
import { skipToken, useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

/**
 * Every tag ExifTool reads in a photo's file and its sidecars (the owner's All metadata view,
 * #2277). Read when asked, never cached for long: the answer is "what the files say now", and
 * each read costs the server an ExifTool run, so it does not refetch on window focus either.
 * `photoId` is the photo's UUID; undefined (the dialog is closed) sends nothing.
 */
export function useRawPhotoMetadataQuery(photoId: string | undefined) {
  return useQuery({
    queryKey: photoKeys.rawMetadata(photoId ?? ""),
    queryFn: photoId ? () => endpoints.fetchRawPhotoMetadata(apiClient, photoId) : skipToken,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
}
