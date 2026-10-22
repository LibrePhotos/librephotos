import { endpoints, settingsKeys } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

/**
 * What each saved date rule reads from one of the user's photos ("Why this date?", #2272). Off
 * while `photoId` is undefined.
 */
export const useDateRulesTestQuery = (photoId: string | undefined) =>
  useQuery({
    queryKey: settingsKeys.dateRulesTest(photoId ?? ""),
    queryFn: () => endpoints.fetchDateRulesTest(apiClient, photoId ?? ""),
    enabled: photoId !== undefined,
    // Read again on every opening: the saved rules may have changed since.
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
