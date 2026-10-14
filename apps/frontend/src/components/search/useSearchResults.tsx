import { ApiError } from "@librephotos/api-client";
import { IconAlertTriangle, IconFilter, IconSearch } from "@tabler/icons-react";
import type { TFunction } from "i18next";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSearchPhotosQuery } from "../../api_client/search/hooks";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { useListFailure } from "../common/useListFailure";
import type { EmptyStateConfig, PhotoListView } from "../photolist/PhotoListView";
import { useMediaTypeFilter } from "../photolist/useMediaTypeFilter";
import { hasSearchFilters, searchSelectAllQuery } from "./searchFilter";
import { SearchFilterButton } from "./SearchFilterButton";
import { SearchFilterChips } from "./SearchFilterChips";
import { useFavoriteRating, useSearchFilters } from "./useSearchFilters";

const DEFAULTS = {
  photosFlat: [],
  photosGroupedByDate: [],
};

type EmptyStateInput = Readonly<{
  term: string;
  filtered: boolean;
  /** The server refused a filter (a 400): its message. */
  rejection: string | undefined;
  clearFilters: () => void;
}>;

/** What the page says when nothing is listed: a refused filter, no filters yet, or no match. */
function searchEmptyState(input: EmptyStateInput, t: TFunction): EmptyStateConfig {
  const { term, filtered, rejection, clearFilters } = input;
  const clear = { actionLabel: t("searchfilter.empty.action"), onAction: clearFilters };
  if (rejection !== undefined) {
    return {
      icon: <IconAlertTriangle size={40} />,
      title: t("searchfilter.rejected.title"),
      description: t("searchfilter.rejected.description", { message: rejection }),
      ...clear,
    };
  }
  if (filtered) {
    return {
      icon: <IconFilter size={40} />,
      title: t("searchfilter.empty.title"),
      description: t("searchfilter.empty.description"),
      ...clear,
    };
  }
  if (term.length === 0) {
    return {
      icon: <IconFilter size={40} />,
      title: t("searchfilter.nofilters.title"),
      description: t("searchfilter.nofilters.description"),
    };
  }
  return {
    icon: <IconSearch size={40} />,
    title: t("emptystate.search.title"),
    description: t("emptystate.search.description", { query: term }),
  };
}

function rejectionOf(error: Error | null): string | undefined {
  if (!(error instanceof ApiError) || error.status !== 400) return undefined;
  // The sentence the page adds after it brings its own full stop.
  return (error.serverMessage ?? "").trim().replace(/\.$/, "");
}

type PhotoListViewProps = React.ComponentProps<typeof PhotoListView>;

/**
 * The photo list of the search results, by words (/search/<words>) or by filters alone (/search/),
 * with the media button, the Filters button and the active filter chips (#2259, #329). Each search
 * route spreads the result into its PhotoListView: the list is the page, with its h1.
 */
export function useSearchResults(term: string): PhotoListViewProps {
  const { t } = useTranslation();
  const { data: currentUser } = useCurrentUserSelfDetailsQuery();
  const mediaType = useMediaTypeFilter();
  const { filters, setFilters, clearFilters } = useSearchFilters();
  const favoriteRating = useFavoriteRating();
  const filtered = hasSearchFilters(filters);

  // isPending, not isFetching: a background refetch (after favouriting or
  // hiding a result) must not blank the grid and lose the scroll position.
  // Not isLoading either: that is false while the query still waits for the
  // user, and the page flashed "No matching photos" on every hard load. A
  // filter-only page without filters asks nothing, so it is not loading.
  const searchResult = useSearchPhotosQuery(term, mediaType, filters);
  const { data: { photosGroupedByDate, photosFlat } = DEFAULTS, isPending, error } = searchResult;
  const listFailure = useListFailure(searchResult);
  const rejection = rejectionOf(error);

  const emptyStateConfig = useMemo(
    () => searchEmptyState({ term, filtered, rejection, clearFilters }, t),
    [term, filtered, rejection, clearFilters, t]
  );
  const photosetQuery = useMemo(() => searchSelectAllQuery(term, filters, mediaType), [term, filters, mediaType]);

  return {
    // No trailing "...": the header shows its own loading state.
    title: term ? t("search.resultsfor", { query: term }) : t("searchfilter.filteredtitle"),
    loading: isPending && (term.length > 0 || filtered),
    icon: term ? IconSearch : IconFilter,
    photoset: currentUser?.semantic_search_topk ? photosFlat : photosGroupedByDate,
    idx2hash: photosFlat,
    mediaType,
    selectable: true,
    emptyStateConfig,
    // A refused filter is not a failed list: the empty state says which and offers to clear.
    error: rejection === undefined ? listFailure : undefined,
    photosetQuery,
    headerActions: (
      <SearchFilterButton
        filters={filters}
        onChange={setFilters}
        onClear={clearFilters}
        favoriteRating={favoriteRating}
        resultCount={photosFlat.length}
      />
    ),
    filterBar: (
      <SearchFilterChips
        filters={filters}
        onChange={setFilters}
        onClear={clearFilters}
        favoriteRating={favoriteRating}
      />
    ),
  };
}
