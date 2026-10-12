import { endpoints } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";
import { albumKeys } from "../keys";

export const useFetchUserAlbumsQuery = (skip: boolean = false) =>
  useQuery({
    queryKey: albumKeys.userAlbums(),
    queryFn: () => endpoints.fetchUserAlbumsList(apiClient),
    enabled: !skip,
  });
