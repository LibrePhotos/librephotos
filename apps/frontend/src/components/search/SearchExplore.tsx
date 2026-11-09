import type { SearchFilters } from "@librephotos/api-client";
import { Skeleton, Stack } from "@mantine/core";
import { IconMap2, IconSearch, IconTag } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  useFetchPeopleAlbumsQuery,
  useFetchPlacesAlbumsQuery,
  useFetchThingsAlbumsQuery,
} from "../../api_client/albums/hooks";
import { AlbumSectionHeading } from "../album/AlbumSection";
import { HubPeopleRow } from "../album/HubPeopleRow";
import { CollectionCard } from "../common/CollectionCard";
import { EmptyState } from "../common/EmptyState";
import { ErrorState } from "../common/ErrorState";
import { useListFailure } from "../common/useListFailure";
import { PageBody } from "../PageBody";
import { PageHeader } from "../PageHeader";
import { displayLabel, explorePeople, explorePlaces, exploreThings } from "./exploreLists";
import classes from "./SearchExplore.module.css";
import { SearchFilterButton, type FilterPanelState } from "./SearchFilterButton";
import { useFavoriteRating } from "./useSearchFilters";

/** The covers' size attribute: about a tile's width on a wide screen. */
const TILE_SIZE = 200;

function TileSkeletons() {
  return (
    <div className={classes.tiles}>
      {[1, 2, 3, 4, 5, 6].map(i => (
        <Skeleton key={i} className={classes.tileSkeleton} radius={12} />
      ))}
    </div>
  );
}

/** The people with the most photos, drawn as everywhere else: the 3:4 portrait cards of the hub. */
function PeopleRow() {
  const query = useFetchPeopleAlbumsQuery();
  const failure = useListFailure(query);
  const people = useMemo(() => explorePeople(query.data ?? []), [query.data]);
  if (!query.isLoading && !failure && people.length === 0) return null;
  return <HubPeopleRow people={people} isLoading={query.isLoading} error={failure} total={query.data?.length ?? 0} />;
}

function PlacesTiles() {
  const { t } = useTranslation();
  const query = useFetchPlacesAlbumsQuery();
  const failure = useListFailure(query);
  const places = useMemo(() => explorePlaces(query.data ?? []), [query.data]);
  if (!query.isLoading && !failure && places.length === 0) return null;
  return (
    <section>
      <AlbumSectionHeading
        title={t("sidemenu.places")}
        summary={t("explore.placeCount", { count: query.data?.length ?? 0 })}
        viewAllLink="/album/places"
      />
      {failure ? (
        <ErrorState failure={failure} compact />
      ) : query.isLoading ? (
        <TileSkeletons />
      ) : (
        <div className={classes.tiles}>
          {places.map(place => (
            <CollectionCard
              key={place.id}
              size={TILE_SIZE}
              title={place.title}
              meta={t("numberofphotos", { count: place.photo_count, number: place.photo_count })}
              covers={place.cover_photos.slice(0, 1)}
              placeholder={<IconMap2 />}
              renderLink={props => <Link {...props} to="/album/places/$id" params={{ id: String(place.id) }} />}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ThingsTiles() {
  const { t } = useTranslation();
  const query = useFetchThingsAlbumsQuery();
  const failure = useListFailure(query);
  const things = useMemo(() => exploreThings(query.data ?? []), [query.data]);
  if (!query.isLoading && !failure && things.length === 0) return null;
  return (
    <section>
      <AlbumSectionHeading
        title={t("sidemenu.things")}
        summary={t("explore.thingCount", { count: query.data?.length ?? 0 })}
        viewAllLink="/album/things"
      />
      {failure ? (
        <ErrorState failure={failure} compact />
      ) : query.isLoading ? (
        <TileSkeletons />
      ) : (
        <div className={classes.tiles}>
          {things.map(thing => (
            <CollectionCard
              key={thing.id}
              size={TILE_SIZE}
              title={displayLabel(thing.title)}
              meta={t("numberofphotos", { count: thing.photo_count, number: thing.photo_count })}
              covers={thing.cover_photos.slice(0, 1)}
              placeholder={<IconTag />}
              renderLink={props => <Link {...props} to="/album/things/$id" params={{ id: String(thing.id) }} />}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/** Whether any section has something to show, from the lists the sections read (cached, shared). */
function useHasAnything() {
  const people = useFetchPeopleAlbumsQuery();
  const places = useFetchPlacesAlbumsQuery();
  const things = useFetchThingsAlbumsQuery();
  const loading = people.isLoading || places.isLoading || things.isLoading;
  const failed = people.isError || places.isError || things.isError;
  const empty =
    explorePeople(people.data ?? []).length === 0 &&
    explorePlaces(places.data ?? []).length === 0 &&
    exploreThings(things.data ?? []).length === 0;
  return loading || failed || !empty;
}

type Props = Readonly<{
  filters: SearchFilters;
  onChange: (patch: SearchFilters) => void;
  onClear: () => void;
  /** The Filter panel's open state, kept by SearchLanding so it stays open as the results replace this page. */
  filterPanel: FilterPanelState;
}>;

/**
 * /search with no words and no filters: an Explore page, as Google Photos and Immich have one. A row
 * of the people with the most photos (portrait cards), then the top places and things as tiles, each with View all.
 * Filter (the header's button) still lists photos by camera, date, rating and the rest.
 */
export function SearchExplore({ filters, onChange, onClear, filterPanel }: Props) {
  const { t } = useTranslation();
  const favoriteRating = useFavoriteRating();
  const hasAnything = useHasAnything();
  return (
    <>
      <PageHeader
        title={t("search.explore")}
        subtitle={t("search.exploresubtitle")}
        actions={
          <SearchFilterButton
            filters={filters}
            onChange={onChange}
            onClear={onClear}
            favoriteRating={favoriteRating}
            resultCount={0}
            {...filterPanel}
          />
        }
      />
      {/* 24px from the header block to the first section (its 12px and these), 40px between sections */}
      <PageBody gap={0} pt={12}>
        {hasAnything ? (
          <Stack gap={40}>
            <PeopleRow />
            <PlacesTiles />
            <ThingsTiles />
          </Stack>
        ) : (
          <EmptyState
            icon={<IconSearch size={40} />}
            title={t("searchfilter.nofilters.title")}
            description={t("searchfilter.nofilters.description")}
          />
        )}
      </PageBody>
    </>
  );
}
