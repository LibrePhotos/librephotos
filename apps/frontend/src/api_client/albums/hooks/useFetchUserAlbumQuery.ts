import { endpoints, photoGridKeys } from "@librephotos/api-client";
import type { MediaType } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { mediaTypeToBulkQuery } from "../../../components/photolist/mediaTypeFilter";
import { apiClient } from "../../api";

export const useFetchUserAlbumQuery = (
  id: string,
  opts?: { public?: boolean; username?: string; mediaType?: MediaType }
) =>
  useQuery({
    queryKey: photoGridKeys.userAlbumView(id, opts?.public ?? false, opts?.username ?? "", opts?.mediaType ?? "all"),
    enabled: Boolean(id),
    queryFn: () =>
      endpoints.fetchUserAlbum(apiClient, id, {
        ...mediaTypeToBulkQuery(opts?.mediaType),
        public: opts?.public,
        username: opts?.username,
      }),
  });
