import type { PlaceAlbumInfo, ThingAlbumInfo, UserAlbumInfo } from "@librephotos/api-client";
import { useMemo, useState } from "react";
import {
  useFetchPeopleAlbumsQuery,
  useFetchPlacesAlbumsQuery,
  useFetchThingsAlbumsQuery,
  useFetchUserAlbumsQuery,
} from "../api_client/albums/hooks";
import type { Person } from "../api_client/albums/hooks/useFetchPeopleAlbumsQuery";
import { useSearchExamplesQuery } from "../api_client/search/hooks/useSearchExamplesQuery";
import { fuzzyMatch } from "../util/util";

export enum SearchOptionType {
  EXAMPLE,
  PLACE_ALBUM,
  THING_ALBUM,
  USER_ALBUM,
  PEOPLE,
}

export type SearchOption = {
  value: string;
  type: SearchOptionType;
  // The search term, or the album's id (a number; a person's is a string): the
  // option's URL is built from it.
  data: string | number | null;
  thumbnail?: string;
};

// Without captioned photos the backend sends these fragments, written to finish an
// old "Search ..." placeholder. As results they read as broken English and search
// for the phrase itself, so they are not offered.
const DEFAULT_SEARCH_HINTS = new Set([
  "for people",
  "for places",
  "for things",
  "for time",
  "for file path or file name",
]);

export function isSearchExample(item: string): boolean {
  return !DEFAULT_SEARCH_HINTS.has(item);
}

function toExampleOption(item: string): SearchOption {
  return { value: item, type: SearchOptionType.EXAMPLE, data: item };
}

function toPlaceOption(item: PlaceAlbumInfo): SearchOption {
  const coverHash = item.cover_photos?.[0]?.image_hash;
  return {
    value: item.title,
    type: SearchOptionType.PLACE_ALBUM,
    data: item.id,
    thumbnail: coverHash,
  };
}

function toThingOption(item: ThingAlbumInfo): SearchOption {
  const coverHash = item.cover_photos?.[0]?.image_hash;
  return {
    value: item.title,
    type: SearchOptionType.THING_ALBUM,
    data: item.id,
    thumbnail: coverHash,
  };
}

function toUserAlbumOption(item: UserAlbumInfo): SearchOption {
  return {
    value: item.title,
    type: SearchOptionType.USER_ALBUM,
    data: item.id,
    thumbnail: item.cover_photo?.image_hash,
  };
}

function toPersonOption(item: Person): SearchOption {
  return { value: item.name, type: SearchOptionType.PEOPLE, data: item.id, thumbnail: item.face_url };
}

/**
 * The suggestions for what is typed into the palette, worked out from the query and whatever has
 * loaded: they follow every refetch, and a list that failed or is still loading only leaves its
 * own group out instead of all of them. `failed` says a list could not be loaded; `retry` asks for
 * those again.
 */
export function useSearch() {
  // Skip queries on public pages to avoid 401 errors
  const isPublicPage = typeof window !== "undefined" && window.location.pathname.startsWith("/public");
  const examplesQuery = useSearchExamplesQuery(isPublicPage);
  const placesQuery = useFetchPlacesAlbumsQuery(isPublicPage);
  const thingsQuery = useFetchThingsAlbumsQuery(isPublicPage);
  const userAlbumsQuery = useFetchUserAlbumsQuery(isPublicPage);
  const peopleQuery = useFetchPeopleAlbumsQuery(isPublicPage);
  const [query, setQuery] = useState("");
  const queries = [examplesQuery, placesQuery, thingsQuery, userAlbumsQuery, peopleQuery];
  const isLoading = queries.some(q => q.isLoading);
  const failed = queries.some(q => q.isError);

  const { data: searchExamples } = examplesQuery;
  const { data: placeAlbums } = placesQuery;
  const { data: thingAlbums } = thingsQuery;
  const { data: userAlbums } = userAlbumsQuery;
  const { data: people } = peopleQuery;
  const options = useMemo(
    (): SearchOption[] => [
      ...(searchExamples ?? [])
        .filter(item => isSearchExample(item) && fuzzyMatch(query, item))
        .slice(0, 2)
        .map(toExampleOption),
      ...(placeAlbums ?? [])
        .filter(item => fuzzyMatch(query, item.title))
        .slice(0, 2)
        .map(toPlaceOption),
      ...(thingAlbums ?? [])
        .filter(item => fuzzyMatch(query, item.title))
        .slice(0, 2)
        .map(toThingOption),
      ...(userAlbums ?? [])
        .filter(item => fuzzyMatch(query, item.title))
        .slice(0, 2)
        .map(toUserAlbumOption),
      ...(people ?? [])
        .filter(item => fuzzyMatch(query, item.name))
        .slice(0, 9)
        .map(toPersonOption),
    ],
    [query, searchExamples, placeAlbums, thingAlbums, userAlbums, people]
  );

  return {
    options,
    filterOptions: setQuery,
    isLoading,
    failed,
    retry: () => queries.filter(q => q.isError).forEach(q => void q.refetch()),
  };
}
