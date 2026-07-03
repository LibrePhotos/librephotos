import { IconSearch as Search } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React from "react";
import { useSearchPhotosQuery } from "../../api_client/search/hooks";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { validateMediaSearch } from "../../components/photolist/mediaTypeFilter";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { useMediaTypeFilter } from "../../components/photolist/useMediaTypeFilter";

export const Route = createFileRoute("/_protected/search/$query")({
  validateSearch: validateMediaSearch,
});
const DEFAULTS = {
  photosFlat: [],
  photosGroupedByDate: [],
};

export function SearchView() {
  const { query: searchQuery } = Route.useParams();
  const { data: currentUser } = useCurrentUserSelfDetailsQuery();
  const mediaType = useMediaTypeFilter();

  const { data: { photosGroupedByDate, photosFlat } = DEFAULTS, isFetching } = useSearchPhotosQuery(
    searchQuery ?? "",
    mediaType
  );

  return (
    <PhotoListView
      title={`Searching "${searchQuery}"...`}
      loading={isFetching}
      icon={<Search size={50} />}
      photoset={currentUser?.semantic_search_topk ? photosFlat : photosGroupedByDate}
      idx2hash={photosFlat}
      mediaType={mediaType}
      selectable
    />
  );
}

Route.update({ component: SearchView });
