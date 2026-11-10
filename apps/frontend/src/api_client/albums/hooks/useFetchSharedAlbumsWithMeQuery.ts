import { albumKeys, endpoints } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { groupEntries } from "../../../util/helpers";
import { apiClient } from "../../api";
import type { UserAlbumsGroupedByUserId } from "./useFetchSharedAlbumsByMeQuery";

export const useFetchSharedAlbumsWithMeQuery = () =>
  useQuery({
    queryKey: albumKeys.sharedWithMe(),
    queryFn: async () => {
      const result = await endpoints.fetchSharedAlbumsWithMe(apiClient);
      const grouped: UserAlbumsGroupedByUserId[] = groupEntries(result, album => album.owner?.id).map(el => ({
        user_id: parseInt(el[0], 10),
        albums: el[1],
      }));
      return grouped;
    },
  });
