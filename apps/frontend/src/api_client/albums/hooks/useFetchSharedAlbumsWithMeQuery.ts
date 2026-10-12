import { useQuery } from "@tanstack/react-query";
import { groupBy, toPairs } from "lodash-es";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient } from "../../api";
import { albumKeys } from "../keys";
import { UserAlbumListResponse } from "../types";
import type { UserAlbumsGroupedByUserId } from "./useFetchSharedAlbumsByMeQuery";

export const useFetchSharedAlbumsWithMeQuery = () =>
  useQuery({
    queryKey: albumKeys.sharedWithMe(),
    queryFn: async () => {
      const response = await fetchClient.get("/albums/user/shared/tome/");
      const result = parseWithNotification(
        UserAlbumListResponse,
        response,
        "Failed to parse shared albums with me"
      ).results;
      const grouped: UserAlbumsGroupedByUserId[] = toPairs(groupBy(result, "owner.id")).map(el => ({
        user_id: parseInt(el[0], 10),
        albums: el[1],
      }));
      return grouped;
    },
  });
