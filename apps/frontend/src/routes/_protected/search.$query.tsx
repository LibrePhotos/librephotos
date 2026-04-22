import { IconSearch as Search } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React from "react";
import { useSearchPhotosQuery } from "../../api_client/search/hooks";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { PhotoListView } from "../../components/photolist/PhotoListView";

export const Route = createFileRoute("/_protected/search/$query")();
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

Route.update({ component: SearchView });
