import React from "react";
// only needs to be imported once
import { Redirect } from "react-router-dom";
import "react-virtualized/styles.css";

import { PhotoListView } from "../components/photolist/PhotoListView";
import { PhotosetType } from "../reducers/photosReducer";
import { useAppSelector } from "../store/store";

export const SearchView = () => {
  const user = useAppSelector(state => state.user.userSelfDetails);
  const photosFlat = useAppSelector(state => state.photos.photosFlat);
  const photosGroupedByDate = useAppSelector(state => state.photos.photosGroupedByDate);
  const fetchedPhotosetType = useAppSelector(state => state.photos.fetchedPhotosetType);
  const searchQuery = useAppSelector(state => state.search.query);

  if (!searchQuery) {
    // User hasn't searched for anything. Redirect to root.
    return <Redirect to="/" />;
  }
  // if semantic search is activated we get a flat array sorted by relevance
  // thats why we have to change the parameters
  const title = `Searching "${searchQuery}"...`;
  // To-Do: Semantic Search broken, Zod Error
  return (
    <PhotoListView
      title={title}
      loading={fetchedPhotosetType !== PhotosetType.SEARCH}
      titleIconName="search"
      isDateView={!user.semantic_search_topk}
      photoset={photosGroupedByDate}
      idx2hash={user.semantic_search_topk ? photosGroupedByDate : photosFlat}
      selectable
    />
  );
};
