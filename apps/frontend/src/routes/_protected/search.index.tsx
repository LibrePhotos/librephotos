import { createFileRoute } from "@tanstack/react-router";
import React from "react";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { validateSearchPage } from "../../components/search/searchFilter";
import { useSearchResults } from "../../components/search/useSearchResults";

// A search by filters alone, without words (/search/?camera=X-T5): the "Filter photos" page.
export const Route = createFileRoute("/_protected/search/")({
  component: FilterView,
  validateSearch: validateSearchPage,
});

function FilterView() {
  const list = useSearchResults("");
  return <PhotoListView {...list} />;
}
