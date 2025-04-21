import { createFileRoute } from '@tanstack/react-router'
import { IconSearch as Search } from "@tabler/icons-react";
import React from "react";

import { useSearchPhotosQuery } from "../../api_client/search/hooks/useSearchPhotosQuery";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";

export const Route = createFileRoute('/_protected/search/$query')({
  component: SearchView,
})
const DEFAULTS = {
  photosFlat: [],
  photosGroupedByDate: [],
};

export function SearchView() {
  const { query: searchQuery } = Route.useParams();
  const { data: currentUser } = useCurrentUserSelfDetailsQuery();

  const { data: { photosGroupedByDate, photosFlat } = DEFAULTS, isFetching } = useSearchPhotosQuery(searchQuery ?? "");

  return (
    <PhotoListView
      title={`Searching "${searchQuery}"...`}
      loading={isFetching}
      icon={<Search size={50} />}
      photoset={currentUser?.semantic_search_topk ? photosFlat : photosGroupedByDate}
      idx2hash={photosFlat}
      selectable
    />
  );
}
