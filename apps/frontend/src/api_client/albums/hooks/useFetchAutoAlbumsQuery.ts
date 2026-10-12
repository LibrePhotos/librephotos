import { endpoints } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";
import { albumKeys } from "../keys";

export const useFetchAutoAlbumsQuery = () =>
  useQuery({
    queryKey: albumKeys.autoAlbums(),
    queryFn: () => endpoints.fetchAutoAlbumsList(apiClient),
  });
