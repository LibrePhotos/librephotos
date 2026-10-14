import { createFileRoute } from "@tanstack/react-router";
import React from "react";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { validateSearchPage } from "../../components/search/searchFilter";
import { useSearchResults } from "../../components/search/useSearchResults";

// A search by words, narrowed by the media button and the search filters in the URL (#2259).
export const Route = createFileRoute("/_protected/search/$query")({
  component: SearchView,
  validateSearch: validateSearchPage,
});

function SearchView() {
  const { query } = Route.useParams();
  const list = useSearchResults(query ?? "");
  return <PhotoListView {...list} />;
}
