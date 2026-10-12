import { endpoints } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { groupBy, toPairs } from "lodash-es";
import { apiClient } from "../../api";
import { albumKeys } from "../keys";
import type { UserAlbumsGroupedByUserId } from "./useFetchSharedAlbumsByMeQuery";

export const useFetchSharedAlbumsWithMeQuery = () =>
  useQuery({
    queryKey: albumKeys.sharedWithMe(),
    queryFn: async () => {
      const result = await endpoints.fetchSharedAlbumsWithMe(apiClient);
      const grouped: UserAlbumsGroupedByUserId[] = toPairs(groupBy(result, "owner.id")).map(el => ({
        user_id: parseInt(el[0], 10),
        albums: el[1],
      }));
      return grouped;
    },
  });
