import { useQuery } from "@tanstack/react-query";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient } from "../../api";
import { albumKeys } from "../keys";
import { UserAlbumListResponse } from "../types";

export const useFetchUserAlbumsQuery = (skip: boolean = false) =>
  useQuery({
    queryKey: albumKeys.userAlbums(),
    queryFn: async () => {
      const response = await fetchClient.get("/albums/user/list/");
      return parseWithNotification(UserAlbumListResponse, response, "Failed to parse user albums").results;
    },
    enabled: !skip,
  });
