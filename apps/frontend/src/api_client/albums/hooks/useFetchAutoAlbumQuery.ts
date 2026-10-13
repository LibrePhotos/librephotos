import { endpoints, photoGridKeys } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

export const useFetchAutoAlbumQuery = (id: string) =>
  useQuery({
    queryKey: photoGridKeys.autoAlbum(id),
    queryFn: () => endpoints.fetchAutoAlbum(apiClient, id),
    enabled: !!id,
  });
