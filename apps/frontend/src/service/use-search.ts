import type { PlaceAlbumInfo, ThingAlbumInfo } from "@librephotos/api-client";
import { useCallback, useEffect, useState } from "react";
import {
  useFetchPeopleAlbumsQuery,
  useFetchPlacesAlbumsQuery,
  useFetchThingsAlbumsQuery,
  useFetchUserAlbumsQuery,
} from "../api_client/albums/hooks";
import type { Person } from "../api_client/albums/hooks/useFetchPeopleAlbumsQuery";
import type { UserAlbumInfo } from "../api_client/albums/types";
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

export function useSearch() {
  // Skip queries on public pages to avoid 401 errors
  const isPublicPage = typeof window !== "undefined" && window.location.pathname.startsWith("/public");
  const { data: searchExamples, isLoading: isExamplesLoading } = useSearchExamplesQuery(isPublicPage);
  const { data: placeAlbums, isLoading: isPlacesLoading } = useFetchPlacesAlbumsQuery(isPublicPage);
  const { data: thingAlbums, isLoading: isThingsLoading } = useFetchThingsAlbumsQuery(isPublicPage);
  const { data: userAlbums, isLoading: isAlbumsLoading } = useFetchUserAlbumsQuery(isPublicPage);
  const { data: people, isLoading: isPeopleLoading } = useFetchPeopleAlbumsQuery(isPublicPage);
  const [options, setOptions] = useState<SearchOption[]>([]);
  const isLoading = isExamplesLoading || isPlacesLoading || isThingsLoading || isAlbumsLoading || isPeopleLoading;

  const filterOptions = useCallback(
    (q: string = "") => {
      if (!searchExamples || !placeAlbums || !thingAlbums || !userAlbums || !people) {
        return;
      }
      setOptions([
        ...searchExamples
          .filter(item => isSearchExample(item) && fuzzyMatch(q, item))
          .slice(0, 2)
          .map(toExampleOption),
        ...placeAlbums
          .filter(item => fuzzyMatch(q, item.title))
          .slice(0, 2)
          .map(toPlaceOption),
        ...thingAlbums
          .filter(item => fuzzyMatch(q, item.title))
          .slice(0, 2)
          .map(toThingOption),
        ...userAlbums
          .filter(item => fuzzyMatch(q, item.title))
          .slice(0, 2)
          .map(toUserAlbumOption),
        ...people
          .filter(item => fuzzyMatch(q, item.name))
          .slice(0, 9)
          .map(toPersonOption),
      ]);
    },
    [placeAlbums, searchExamples, thingAlbums, userAlbums, people]
  );

  // Seed the unfiltered options once everything has loaded. Deliberately not
  // re-run when filterOptions changes (any refetch): that would replace the
  // options for the query the user is typing with the unfiltered list.
  useEffect(() => {
    if (!isLoading) filterOptions("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  return {
    options,
    filterOptions,
    isLoading,
  };
}
