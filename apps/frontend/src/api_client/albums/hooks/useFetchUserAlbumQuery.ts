import { endpoints, photoGridKeys } from "@librephotos/api-client";
import type { MediaType, UserAlbum } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { mediaTypeToBulkQuery } from "../../../components/photolist/mediaTypeFilter";
import { withOrderedGroups } from "../../../util/photoOrder";
import { apiClient } from "../../api";
import { usePhotoOrderSelect } from "../../user/hooks/usePhotoOrder";

// The album's days in the user's photo order (#2712).
export const useFetchUserAlbumQuery = (
  id: string,
  opts?: { public?: boolean; username?: string; mediaType?: MediaType }
) => {
  const { select, ready } = usePhotoOrderSelect<UserAlbum>(withOrderedGroups);
  return useQuery({
    queryKey: photoGridKeys.userAlbumView(id, opts?.public ?? false, opts?.username ?? "", opts?.mediaType ?? "all"),
    enabled: Boolean(id) && ready,
    select,
    queryFn: () =>
      endpoints.fetchUserAlbum(apiClient, id, {
        ...mediaTypeToBulkQuery(opts?.mediaType),
        public: opts?.public,
        username: opts?.username,
      }),
  });
};
