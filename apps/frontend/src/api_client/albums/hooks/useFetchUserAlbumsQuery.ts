import { fetchAllPages } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient } from "../../api";
import { albumKeys } from "../keys";
import { UserAlbumListResponse } from "../types";

export const useFetchUserAlbumsQuery = (skip: boolean = false) =>
  useQuery({
    queryKey: albumKeys.userAlbums(),
    queryFn: async () => {
      const results = await fetchAllPages(fetchClient, "/albums/user/list/");
      return parseWithNotification(UserAlbumListResponse, { results }, "Failed to parse user albums").results;
    },
    enabled: !skip,
  });
