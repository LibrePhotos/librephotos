import { endpoints, settingsKeys } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

/**
 * What "Write metadata to files" (#2287) would write now: where, and how many photos per type. The
 * server reads the saved settings, so the key carries them (`mode`, `faceTags`) and a save refetches.
 */
export const useWriteMetadataPreviewQuery = (mode: string, faceTags: boolean) =>
  useQuery({
    queryKey: settingsKeys.writeMetadataPreview(mode, faceTags),
    queryFn: () => endpoints.fetchWriteMetadataPreview(apiClient),
    // Edits change the counts any time: count again whenever the card shows.
    staleTime: 0,
  });
