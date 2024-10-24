import { Autocomplete, Avatar, Group, Text, createStyles } from "@mantine/core";
import type { AutocompleteItem } from "@mantine/core";
import { useInterval, useViewportSize } from "@mantine/hooks";
import {
  IconAlbum as Album,
  IconMap as Map,
  IconSearch as Search,
  IconTag as Tag,
  IconX as X,
} from "@tabler/icons-react";
import { random } from "lodash";
import React, { cloneElement, forwardRef, useCallback, useEffect, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { push } from "redux-first-history";

import { Person, useFetchPeopleAlbumsQuery } from "../api_client/albums/people";
import { useFetchPlacesAlbumsQuery } from "../api_client/albums/places";
import { useFetchThingsAlbumsQuery } from "../api_client/albums/things";
import { useFetchUserAlbumsQuery } from "../api_client/albums/user";
import { useSearchExamplesQuery } from "../api_client/search";
import { useAppDispatch } from "../store/store";
import { fuzzyMatch } from "../util/util";

enum SuggestionType {
  EXAMPLE,
  PLACE_ALBUM,
  THING_ALBUM,
  USER_ALBUM,
  PEOPLE,
}

interface SearchSuggestion {
  value: string;
  icon: ReactNode;
  [key: string]: any;
}

function toExampleSuggestion(item: string) {
  return { value: item, type: SuggestionType.EXAMPLE };
}

function toPlaceSuggestion(item: any) {
  return { value: item.title, icon: <Map />, type: SuggestionType.PLACE_ALBUM, id: item.id };
}

function toThingSuggestion(item: any) {
  return { value: item.title, icon: <Tag />, type: SuggestionType.THING_ALBUM, id: item.id };
}

function toUserAlbumSuggestion(item: any) {
  return { value: item.title, icon: <Album />, type: SuggestionType.USER_ALBUM, id: item.id };
}

function toPeopleSuggestion(item: Person) {
  return {
    value: item.name,
    icon: <Avatar src={item.face_url} alt={item.name} size="xl" />,
    type: SuggestionType.PEOPLE,
    id: item.id,
  };
}

const SearchSuggestionItem = forwardRef<HTMLDivElement, SearchSuggestion>(
  ({ icon = <Search />, value, ...rest }: SearchSuggestion, ref) => (
    /* eslint-disable react/jsx-props-no-spreading */
    <div ref={ref} {...rest}>
      <Group noWrap>
        {cloneElement(icon as React.ReactElement, { size: 20 })}
        <Text>{value}</Text>
      </Group>
    </div>
  )
);

export const useStyles = createStyles(() => ({
  clear: {
    color: "#333",
    cursor: "pointer",
  },
  icon: {
    color: "#333",
  },
}));

export function CustomSearch() {
  const { t } = useTranslation();
  const { classes } = useStyles();
  const { width } = useViewportSize();
  const dispatch = useAppDispatch();
  const [value, setValue] = useState("");
  const [searchSuggestions, setSearchSuggestions] = useState<Array<AutocompleteItem>>([]);
  const [searchPlaceholder, setSearchPlaceholder] = useState("");
  const searchBarWidth = width - width / 2.2;
  const { data: searchExamples } = useSearchExamplesQuery();
  const { data: placeAlbums } = useFetchPlacesAlbumsQuery();
  const { data: thingAlbums } = useFetchThingsAlbumsQuery();
  const { data: userAlbums } = useFetchUserAlbumsQuery();
  const { data: people } = useFetchPeopleAlbumsQuery();

  const updateSearchPlaceholder = useInterval(() => {
    if (!searchExamples) {
      return;
    }
    const example = searchExamples[Math.floor(random(0.1, 1) * searchExamples.length)];
    setSearchPlaceholder(`${t("search.search")} ${example}`);
  }, 5000);

  const filterSearch = useCallback(
    (query: string = "") => {
      if (!searchExamples || !placeAlbums || !thingAlbums || !userAlbums || !people) {
        return;
      }
      setValue(query);
      setSearchSuggestions([
        ...searchExamples
          .filter((item: string) => fuzzyMatch(query, item))
          .slice(0, 2)
          .map(toExampleSuggestion),
        ...placeAlbums
          .filter((item: any) => fuzzyMatch(query, item.title))
          .slice(0, 2)
          .map(toPlaceSuggestion),
        ...thingAlbums
          .filter((item: any) => fuzzyMatch(query, item.title))
          .slice(0, 2)
          .map(toThingSuggestion),
        ...userAlbums
          .filter((item: any) => fuzzyMatch(query, item.title))
          .slice(0, 2)
          .map(toUserAlbumSuggestion),
        ...people
          .filter((item: Person) => fuzzyMatch(query, item.name))
          .slice(0, 2)
          .map(toPeopleSuggestion),
      ]);
    },
    [placeAlbums, searchExamples, thingAlbums, userAlbums, people]
  );

  function search(item: AutocompleteItem) {
    switch (item.type) {
      case undefined:
      case SuggestionType.EXAMPLE:
        dispatch(push(`/search/${item.value}`));
        break;
      case SuggestionType.USER_ALBUM:
        dispatch(push(`/useralbum/${item.id}`));
        break;
      case SuggestionType.PLACE_ALBUM:
        dispatch(push(`/place/${item.id}`));
        break;
      case SuggestionType.THING_ALBUM:
        dispatch(push(`/thing/${item.id}`));
        break;
      case SuggestionType.PEOPLE:
        dispatch(push(`/person/${item.id}`));
        break;
      default:
        break;
    }
  }

  function onKeyUp(event: KeyboardEvent<HTMLInputElement>) {
    if (event.code === "Enter") {
      search({ value: event.currentTarget.value, icon: undefined });
    }
  }

  useEffect(() => {
    filterSearch();
  }, [searchExamples, placeAlbums, thingAlbums, userAlbums, people, filterSearch]);

  useEffect(() => {
    updateSearchPlaceholder.start();
    return updateSearchPlaceholder.stop;
  }, [updateSearchPlaceholder]);

  return (
    <Autocomplete
      width={searchBarWidth}
      data={searchSuggestions}
      icon={<Search size={14} className={classes.icon} />}
      placeholder={searchPlaceholder}
      itemComponent={SearchSuggestionItem}
      limit={10}
      value={value}
      onChange={e => filterSearch(e)}
      onItemSubmit={e => search(e)}
      onKeyUp={e => onKeyUp(e)}
      rightSection={
        value ? (
          <X
            className={classes.clear}
            size={13}
            onClick={() => {
              setValue("");
              filterSearch();
            }}
          />
        ) : null
      }
    />
  );
}
