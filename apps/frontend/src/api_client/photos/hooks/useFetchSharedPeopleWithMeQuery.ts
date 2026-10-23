import { albumKeys, endpoints } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

/** The people the owners named on the photos shared with me, one entry per owner and person (#2722). */
export const useFetchSharedPeopleWithMeQuery = () =>
  useQuery({
    queryKey: albumKeys.sharedWithMeGroups("people"),
    queryFn: () => endpoints.fetchSharedPeopleWithMe(apiClient),
  });
