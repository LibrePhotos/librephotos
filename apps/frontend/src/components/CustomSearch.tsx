import { Autocomplete, Avatar, Group, Text } from "@mantine/core";
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

import { Person, useFetchPeopleAlbumsQuery } from "../api_client/albums/hooks";
import { useFetchPlacesAlbumsQuery } from "../api_client/albums/hooks";
import { useFetchThingsAlbumsQuery } from "../api_client/albums/hooks";
import { useFetchUserAlbumsQuery } from "../api_client/albums/hooks";
import { useSearchExamplesQuery } from "../api_client/search/hooks/useSearchExamplesQuery";
import { fuzzyMatch } from "../util/util";
import { useNavigate } from "@tanstack/react-router";

enum Suggestion { 
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
  return { value: item, type: Suggestion.EXAMPLE };
}

function toPlaceSuggestion(item: any) {
  return { value: item.title, icon: <Map />, type: Suggestion.PLACE_ALBUM, id: item.id };
}

function toThingSuggestion(item: any) {
  return { value: item.title, icon: <Tag />, type: Suggestion.THING_ALBUM, id: item.id };
}

function toUserAlbumSuggestion(item: any) {
  return { value: item.title, icon: <Album />, type: Suggestion.USER_ALBUM, id: item.id };
}

function toPeopleSuggestion(item: Person) {
  return {
    value: item.name,
    icon: <Avatar src={item.face_url} alt={item.name} size="xl" />,
    type: Suggestion.PEOPLE,
    id: item.id,
  };
}

const SearchSuggestionItem = forwardRef<HTMLDivElement, SearchSuggestion>(
  ({ icon = <Search />, value, ...rest }: SearchSuggestion, ref) => (
    <div ref={ref} {...rest}>
      <Group wrap="nowrap">
        {cloneElement(icon as React.ReactElement, { size: 20 })}
        <Text>{value}</Text>
      </Group>
    </div>
  )
);

export function CustomSearch() {
  const { t } = useTranslation();
  const { width } = useViewportSize();
  const [value, setValue] = useState("");
  const [searchSuggestions, setSearchSuggestions] = useState<Array<any>>([]);
  const [searchPlaceholder, setSearchPlaceholder] = useState("");
  const searchBarWidth = width - width / 2.2;
  const { data: searchExamples } = useSearchExamplesQuery();
  const { data: placeAlbums } = useFetchPlacesAlbumsQuery();
  const { data: thingAlbums } = useFetchThingsAlbumsQuery();
  const { data: userAlbums } = useFetchUserAlbumsQuery();
  const { data: people } = useFetchPeopleAlbumsQuery();
  const navigate = useNavigate();

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

  // TODO: replace any with custom autocomplete item type
  function search(item: any) {
    switch (item.type) {
      case undefined:
      case Suggestion.EXAMPLE:
        navigate({ to: `/search/${item.value}` });
        break;
      case Suggestion.USER_ALBUM:
        navigate({ to: `/album/user/${item.id}` });
        break;
      case Suggestion.PLACE_ALBUM:
        navigate({ to: `/album/places/${item.id}` });
        break;
      case Suggestion.THING_ALBUM:
        navigate({ to: `/album/things/${item.id}` });
        break;
      case Suggestion.PEOPLE:
        navigate({ to: `/album/persons/${item.id}` });
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
      leftSection={<Search size={14} style={{ color: "#333" }} />}
      placeholder={searchPlaceholder}
      component={SearchSuggestionItem}
      limit={10}
      value={value}
      onChange={e => filterSearch(e)}
      onSubmit={e => search(e)}
      onKeyUp={e => onKeyUp(e)}
      rightSection={
        value ? (
          <X
            style={{
              color: "#333",
              cursor: "pointer",
            }}
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
