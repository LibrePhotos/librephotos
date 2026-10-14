import { endpoints, settingsKeys } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

/**
 * Admin: how many photos a trash retention of `days` would delete at the next cleanup (#2203), for
 * the confirmation before it is turned on or shortened. Off while `days` is null.
 */
export const useTrashRetentionPreviewQuery = (days: number | null) =>
  useQuery({
    queryKey: settingsKeys.trashRetentionPreview(days ?? 0),
    queryFn: () => endpoints.fetchTrashRetentionPreview(apiClient, days ?? 0),
    enabled: days !== null && days > 0,
    // Counted when the dialog opens: the trash changes, so a count from an earlier visit is stale.
    staleTime: 0,
    gcTime: 0,
  });
