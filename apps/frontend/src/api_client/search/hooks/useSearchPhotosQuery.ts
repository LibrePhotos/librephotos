import { endpoints } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { mediaTypeToBulkQuery, type MediaType } from "../../../components/photolist/mediaTypeFilter";
import { apiClient } from "../../api";
import { photoGridKeys } from "../../photos/keys";
import { useCurrentUserSelfDetailsQuery } from "../../user/hooks/useCurrentUserSelfDetailsQuery";

export const useSearchPhotosQuery = (searchTerm: string, mediaType?: MediaType) => {
  const { data: currentUser, isError: userFailed } = useCurrentUserSelfDetailsQuery();
  // The backend picks the response shape from this user setting, so the query
  // waits for the user (on a hard load of /search/<q> it is not loaded yet, and
  // a flat semantic result parsed as date groups failed with a toast) and is
  // keyed by it (switching the setting must not reuse the other shape). If the
  // user cannot be loaded, search anyway with the default shape rather than
  // never sending the query.
  const semantic = (currentUser?.semantic_search_topk ?? 0) > 0;

  return useQuery({
    queryKey: photoGridKeys.search(searchTerm, mediaType ?? "all", semantic ? "semantic" : "grouped"),
    queryFn: () => endpoints.searchPhotos(apiClient, searchTerm, semantic, mediaTypeToBulkQuery(mediaType)),
    enabled: searchTerm.length > 0 && (currentUser !== undefined || userFailed),
  });
};
