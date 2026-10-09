import { IconSearch as Search } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSearchPhotosQuery } from "../../api_client/search/hooks";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { validateMediaSearch } from "../../components/photolist/mediaTypeFilter";
import { EmptyStateConfig, PhotoListView } from "../../components/photolist/PhotoListView";
import { useMediaTypeFilter } from "../../components/photolist/useMediaTypeFilter";

export const Route = createFileRoute("/_protected/search/$query")({
  component: SearchView,
  validateSearch: validateMediaSearch,
});
const DEFAULTS = {
  photosFlat: [],
  photosGroupedByDate: [],
};

function SearchView() {
  const { t } = useTranslation();
  const { query: searchQuery } = Route.useParams();
  const { data: currentUser } = useCurrentUserSelfDetailsQuery();
  const mediaType = useMediaTypeFilter();

  // isPending, not isFetching: a background refetch (after favouriting or
  // hiding a result) must not blank the grid and lose the scroll position.
  // Not isLoading either: that is false while the query still waits for the
  // user, and the page flashed "No matching photos" on every hard load.
  const { data: { photosGroupedByDate, photosFlat } = DEFAULTS, isPending } = useSearchPhotosQuery(
    searchQuery ?? "",
    mediaType
  );

  // Like every other grid page, say so when nothing matched instead of
  // leaving the page blank.
  const emptyStateConfig: EmptyStateConfig = useMemo(
    () => ({
      icon: <Search size={40} />,
      title: t("emptystate.search.title"),
      description: t("emptystate.search.description", { query: searchQuery }),
    }),
    [t, searchQuery]
  );

  return (
    <PhotoListView
      // No trailing "...": the header shows its own loading state.
      title={t("search.resultsfor", { query: searchQuery })}
      loading={isPending}
      icon={<Search size={50} />}
      photoset={currentUser?.semantic_search_topk ? photosFlat : photosGroupedByDate}
      idx2hash={photosFlat}
      mediaType={mediaType}
      selectable
      emptyStateConfig={emptyStateConfig}
    />
  );
}
