import { useQuery } from "@tanstack/react-query";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient } from "../../api";
import { UserAlbumListResponse } from "../types";

export const UserAlbumsQueryKeys = ["userAlbums"] as const;

export const useFetchUserAlbumsQuery = () =>
  useQuery({
    queryKey: [...UserAlbumsQueryKeys],
    queryFn: async () => {
      const response = await fetchClient.get("/albums/user/list/");
      return parseWithNotification(UserAlbumListResponse, response, "Failed to parse user albums").results;
    },
  });
