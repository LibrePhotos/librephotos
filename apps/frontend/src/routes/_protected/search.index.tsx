import { useDisclosure } from "@mantine/hooks";
import { createFileRoute } from "@tanstack/react-router";
import React from "react";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { SearchExplore } from "../../components/search/SearchExplore";
import { hasSearchFilters, validateSearchPage } from "../../components/search/searchFilter";
import { useSearchFilters } from "../../components/search/useSearchFilters";
import { useSearchResults } from "../../components/search/useSearchResults";

// /search without words: the Explore page (people, places, things) until a filter is set, then the
// photos the filters find (/search/?camera=X-T5).
export const Route = createFileRoute("/_protected/search/")({
  component: SearchLanding,
  validateSearch: validateSearchPage,
});

function SearchLanding() {
  const { filters, setFilters, clearFilters } = useSearchFilters();
  // The Filter panel's open state lives here, so it stays open as the results replace Explore.
  const [opened, { open, close }] = useDisclosure(false);
  const filterPanel = { opened, onOpenedChange: (next: boolean) => (next ? open() : close()) };
  // Without filters the search asks nothing.
  const list = useSearchResults("", filterPanel);
  if (hasSearchFilters(filters)) return <PhotoListView {...list} />;
  return <SearchExplore filters={filters} onChange={setFilters} onClear={clearFilters} filterPanel={filterPanel} />;
}
