import { useInterval } from "@mantine/hooks";
import { random } from "lodash";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useFetchPeopleAlbumsQuery } from "../api_client/albums/people";
import { useFetchPlacesAlbumsQuery } from "../api_client/albums/places";
import { useFetchThingsAlbumsQuery } from "../api_client/albums/things";
import { useFetchUserAlbumsQuery } from "../api_client/albums/user";
import { useSearchExamplesQuery } from "../api_client/search";
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
  data: string | null;
};

function toExampleOption(item: string): SearchOption {
  return { value: item, type: SearchOptionType.EXAMPLE, data: item };
}

function toPlaceOption(item: any): SearchOption {
  return { value: item.title, type: SearchOptionType.PLACE_ALBUM, data: item.id };
}

function toThingOption(item: any): SearchOption {
  return { value: item.title, type: SearchOptionType.THING_ALBUM, data: item.id };
}

function toUserAlbumOption(item: any): SearchOption {
  return { value: item.title, type: SearchOptionType.USER_ALBUM, data: item.id };
}

function toPersonOption(item: any): SearchOption {
  return { value: item.value, type: SearchOptionType.PEOPLE, data: item.key };
}

export function useSearch() {
  const { t } = useTranslation();
  const { data: searchExamples, isLoading: isExamplesLoading } = useSearchExamplesQuery();
  const { data: placeAlbums, isLoading: isPlacesLoading } = useFetchPlacesAlbumsQuery();
  const { data: thingAlbums, isLoading: isThingsLoading } = useFetchThingsAlbumsQuery();
  const { data: userAlbums, isLoading: isAlbumsLoading } = useFetchUserAlbumsQuery();
  const { data: people, isLoading: isPeopleLoading } = useFetchPeopleAlbumsQuery();
  const [options, setOptions] = useState<SearchOption[]>([]);
  const [placeholder, setPlaceholder] = useState(t("search.search"));
  const isLoading = isExamplesLoading || isPlacesLoading || isThingsLoading || isAlbumsLoading || isPeopleLoading;

  const filterOptions = useCallback(
    (q: string = "") => {
      if (!searchExamples || !placeAlbums || !thingAlbums || !userAlbums || !people) {
        return;
      }
      setOptions([
        ...searchExamples
          .filter((item: string) => fuzzyMatch(q, item))
          .slice(0, 2)
          .map(toExampleOption),
        ...placeAlbums
          .filter((item: any) => fuzzyMatch(q, item.title))
          .slice(0, 2)
          .map(toPlaceOption),
        ...thingAlbums
          .filter((item: any) => fuzzyMatch(q, item.title))
          .slice(0, 2)
          .map(toThingOption),
        ...userAlbums
          .filter((item: any) => fuzzyMatch(q, item.title))
          .slice(0, 2)
          .map(toUserAlbumOption),
        ...people
          .filter((item: any) => fuzzyMatch(q, item.value))
          .slice(0, 2)
          .map(toPersonOption),
      ]);
    },
    [placeAlbums, searchExamples, thingAlbums, userAlbums, people]
  );

  const updateSearchPlaceholder = useInterval(() => {
    if (!searchExamples) {
      return;
    }
    const example = searchExamples[Math.floor(random(0.1, 1) * searchExamples.length)];
    setPlaceholder(`${t("search.search")} ${example}`);
  }, 5000);

  useEffect(() => {
    updateSearchPlaceholder.start();
    return updateSearchPlaceholder.stop;
  }, [updateSearchPlaceholder]);

  useEffect(() => {
    if (!isLoading) filterOptions("");
  }, [isLoading]);

  return {
    options,
    filterOptions,
    placeholder,
    isLoading,
  };
}
