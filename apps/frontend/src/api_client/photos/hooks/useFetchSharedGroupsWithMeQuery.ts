import { albumKeys, endpoints, type SharedGroupKind } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

/** The places or things of the photos shared with me, one entry per title (#2721). */
export const useFetchSharedGroupsWithMeQuery = (kind: SharedGroupKind) =>
  useQuery({
    queryKey: albumKeys.sharedWithMeGroups(kind),
    queryFn: () => endpoints.fetchSharedGroupsWithMe(apiClient, kind),
  });
