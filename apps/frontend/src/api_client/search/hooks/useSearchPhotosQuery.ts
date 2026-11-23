import { ApiError, endpoints, photoGridKeys } from "@librephotos/api-client";
import type { MediaType, PhotoOrder, SearchFilters, SearchPhotosResult, SearchSort } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { mediaTypeToBulkQuery } from "../../../components/photolist/mediaTypeFilter";
import { isSizeSort } from "../../../components/photolist/photoSort";
import { orderDateGroups } from "../../../util/photoOrder";
import { apiClient } from "../../api";
import { useCurrentUserSelfDetailsQuery } from "../../user/hooks/useCurrentUserSelfDetailsQuery";
import { usePhotoOrder } from "../../user/hooks/usePhotoOrder";

/**
 * Date-grouped results in the user's photo order (#2712), the flat list (the lightbox's) with them.
 * Semantic results are a flat list by relevance and stay as they are.
 */
export function orderSearchResult(result: SearchPhotosResult, order: PhotoOrder): SearchPhotosResult {
  if (order === "newest" || result.photosGroupedByDate.length === 0) return result;
  const photosGroupedByDate = orderDateGroups(result.photosGroupedByDate, order);
  return { photosGroupedByDate, photosFlat: photosGroupedByDate.flatMap(group => group.items) };
}

/**
 * A search: the words, the media button and the structured filters (#2259, #329). With filters the
 * words may be empty (the filter-only search page); without either nothing is asked.
 */
export const useSearchPhotosQuery = (
  searchTerm: string,
  mediaType?: MediaType,
  filters: SearchFilters = {},
  sort: SearchSort = "newest"
) => {
  const { data: currentUser, isError: userFailed } = useCurrentUserSelfDetailsQuery();
  // The backend picks the response shape from this user setting, so the query
  // waits for the user (on a hard load of /search/<q> it is not loaded yet, and
  // a flat semantic result parsed as date groups failed with a toast) and is
  // keyed by it (switching the setting must not reuse the other shape). If the
  // user cannot be loaded, search anyway with the default shape rather than
  // never sending the query.
  const semantic = (currentUser?.semantic_search_topk ?? 0) > 0;
  const filtered = Object.values(filters).some(value => value !== undefined);
  const { ready } = usePhotoOrder();
  const order: PhotoOrder = sort === "oldest" ? "oldest" : "newest";
  const select = useCallback((data: SearchPhotosResult) => orderSearchResult(data, order), [order]);
  const keySort = sort === "newest" ? undefined : sort;

  return useQuery({
    // Unfiltered searches keep their old key; a filtered one sits under it, so both refresh together.
    queryKey: filtered
      ? photoGridKeys.filteredSearch(
          searchTerm,
          mediaType ?? "all",
          semantic ? "semantic" : "grouped",
          filters,
          keySort
        )
      : photoGridKeys.search(searchTerm, mediaType ?? "all", semantic ? "semantic" : "grouped", keySort),
    queryFn: () =>
      endpoints.searchPhotos(
        apiClient,
        searchTerm,
        semantic,
        { ...mediaTypeToBulkQuery(mediaType), ...filters },
        keySort
      ),
    enabled:
      (searchTerm.length > 0 || filtered || isSizeSort(sort)) &&
      (currentUser !== undefined || userFailed) &&
      ready,
    select,
    // A 400 is a filter the server will not take (a person deleted elsewhere): asking again changes nothing.
    retry: (failures, error) => !(error instanceof ApiError && error.status === 400) && failures < 1,
  });
};
