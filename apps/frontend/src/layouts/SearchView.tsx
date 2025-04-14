import { IconSearch as Search } from "@tabler/icons-react";
import React from "react";
import { useParams } from "react-router-dom";
import "react-virtualized/styles.css";

import { useSearchPhotosQuery } from "../api_client/search/hooks/useSearchPhotosQuery";
import { PhotoListView } from "../components/photolist/PhotoListView";
import { useCurrentUserSelfDetailsQuery } from "../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
const DEFAULTS = {
  photosFlat: [],
  photosGroupedByDate: [],
};

export function SearchView() {
  const { query: searchQuery } = useParams();
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
