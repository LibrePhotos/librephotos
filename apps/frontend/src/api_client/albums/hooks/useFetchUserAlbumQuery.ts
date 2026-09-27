import { endpoints } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { mediaTypeToBulkQuery, type MediaType } from "../../../components/photolist/mediaTypeFilter";
import { apiClient } from "../../api";

export const UserAlbumQueryKeys = ["userAlbum"] as const;

export const useFetchUserAlbumQuery = (
  id: string,
  opts?: { public?: boolean; username?: string; mediaType?: MediaType }
) =>
  useQuery({
    queryKey: [...UserAlbumQueryKeys, id, opts?.public ?? false, opts?.username ?? "", opts?.mediaType ?? "all"],
    enabled: Boolean(id),
    queryFn: () =>
      endpoints.fetchUserAlbum(apiClient, id, {
        ...mediaTypeToBulkQuery(opts?.mediaType),
        public: opts?.public,
        username: opts?.username,
      }),
  });
