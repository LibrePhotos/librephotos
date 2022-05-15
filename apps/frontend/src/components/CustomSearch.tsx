import { Avatar, Button, Group, Popover, Stack, TextInput } from "@mantine/core";
import { useViewportSize } from "@mantine/hooks";
import { push } from "connected-react-router";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Album, Map, Search, Tag } from "tabler-icons-react";

import {
  fetchPlaceAlbum,
  fetchPlaceAlbumsList,
  fetchThingAlbumsList,
  fetchUserAlbum,
  fetchUserAlbumsList,
} from "../actions/albumsActions";
import { fetchPeople } from "../actions/peopleActions";
import { searchPeople, searchPhotos, searchPlaceAlbums, searchThingAlbums } from "../actions/searchActions";
import { fetchExampleSearchTerms } from "../actions/utilActions";
import { serverAddress } from "../api_client/apiClient";
import { useAppDispatch, useAppSelector } from "../store/store";

const ENTER_KEY = 13;

function fuzzy_match(str, pattern) {
  if (pattern.split("").length > 0) {
    pattern = pattern.split("").reduce((a, b) => `${a}.*${b}`);
    return new RegExp(pattern).test(str);
  }
  return false;
}

export const CustomSearch = () => {
  const { t } = useTranslation();
  const [searchText, setSearchText] = useState("");
  const { width } = useViewportSize();
  const [exampleSearchTerm, setExampleSearchTerm] = useState("");
  const [searchBarFocused, setSearchBarFocused] = useState(false);
  const [filteredExampleSearchTerms, setFilteredExampleSearchTerms] = useState<any[]>([]);
  const [filteredSuggestedPeople, setFilteredSuggestedPeople] = useState<any[]>([]);
  const [filteredSuggestedPlaces, setFilteredSuggestedPlaces] = useState<any[]>([]);
  const [filteredSuggestedThings, setFilteredSuggestedThings] = useState<any[]>([]);
  const [filteredSuggestedUserAlbums, setFilteredSuggestedUserAlbums] = useState<any[]>([]);
  const exampleSearchTerms = useAppSelector(store => store.util.exampleSearchTerms);
  const people = useAppSelector(store => store.people.people);
  const { albumsThingList, albumsUserList, albumsPlaceList } = useAppSelector(store => store.albums);

  const dispatch = useAppDispatch();

  useEffect(() => {
    dispatch(fetchExampleSearchTerms());
    const interval = setInterval(() => {
      const searchTerm = exampleSearchTerms
        ? `${t("search.search")} ${exampleSearchTerms[Math.floor(Math.random() * exampleSearchTerms.length)]}`
        : t("search.default");
      setExampleSearchTerm(searchTerm);
    }, 5000);
    return () => {
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (searchBarFocused) {
      if (people.length == 0) {
        fetchPeople(dispatch);
      }
      if (albumsPlaceList.length == 0) {
        dispatch(fetchPlaceAlbumsList());
      }
      if (albumsThingList.length == 0) {
        dispatch(fetchThingAlbumsList());
      }
      if (albumsUserList.length == 0) {
        dispatch(fetchUserAlbumsList());
      }
    }
  }, [searchBarFocused]);

  const filterSearchSuggestions = () => {
    if (searchText.trim().length === 0) {
      var filteredExampleSearchTerms = [];
      var filteredSuggestedPeople = [];
      var filteredSuggestedPlaces = [];
      var filteredSuggestedThings = [];
      var filteredSuggestedUserAlbums = [];
    } else {
      filteredExampleSearchTerms = exampleSearchTerms.filter(el =>
        fuzzy_match(el.toLowerCase(), searchText.toLowerCase())
      );
      filteredSuggestedPeople = people.filter(person =>
        fuzzy_match(person.text.toLowerCase(), searchText.toLowerCase())
      );
      filteredSuggestedPlaces = albumsPlaceList.filter(place =>
        fuzzy_match(place.title.toLowerCase(), searchText.toLowerCase())
      );
      filteredSuggestedThings = albumsThingList.filter(thing =>
        fuzzy_match(thing.title.toLowerCase(), searchText.toLowerCase())
      );
      filteredSuggestedUserAlbums = albumsUserList.filter(album =>
        fuzzy_match(album.title.toLowerCase(), searchText.toLowerCase())
      );
    }
    setFilteredExampleSearchTerms(filteredExampleSearchTerms);
    setFilteredSuggestedPeople(filteredSuggestedPeople);
    setFilteredSuggestedPlaces(filteredSuggestedPlaces);
    setFilteredSuggestedThings(filteredSuggestedThings);
    setFilteredSuggestedUserAlbums(filteredSuggestedUserAlbums);
  };

  const handleChange = d => {
    setSearchText(d.currentTarget.value);
    console.log(d.currentTarget);
    filterSearchSuggestions();
  };

  const searchBarWidth = width - width / 2.2;

  return (
    <Stack>
      <Popover
        opened={searchBarFocused}
        onClose={() => setSearchBarFocused(false)}
        trapFocus={false}
        width={searchBarWidth}
        onFocusCapture={() => setSearchBarFocused(true)}
        onBlurCapture={() => setSearchBarFocused(false)}
        target={
          <TextInput
            icon={<Search size={14} />}
            onKeyDown={event => {
              switch (event.keyCode) {
                case ENTER_KEY:
                  dispatch(searchPhotos(searchText));
                  dispatch(push("/search"));
                  setSearchBarFocused(false);
                  break;
                default:
                  break;
              }
            }}
            onChange={handleChange}
            placeholder={exampleSearchTerm}
          />
        }
        position="bottom"
      >
        <Stack spacing="xs">
          {filteredExampleSearchTerms.length > 0 &&
            filteredExampleSearchTerms.slice(0, 2).map(el => (
              <Button
                variant="subtle"
                leftIcon={<Search size={14} />}
                key={`suggestion_${el}`}
                onClick={() => {
                  dispatch(searchPhotos(el));
                  dispatch(searchPeople(el));
                  dispatch(searchThingAlbums(el));
                  dispatch(searchPlaceAlbums(el));
                  dispatch(push("/search"));
                }}
              >
                {el}
              </Button>
            ))}
          {filteredSuggestedUserAlbums.length > 0 &&
            filteredSuggestedUserAlbums.slice(0, 2).map(album => (
              <Button
                variant="subtle"
                leftIcon={<Album size={14} />}
                key={`suggestion_place_${album.title}`}
                onClick={() => {
                  dispatch(push(`/useralbum/${album.id}`));
                  dispatch(fetchUserAlbum(album.id));
                }}
              >
                {album.title}
              </Button>
            ))}
          {filteredSuggestedPlaces.length > 0 &&
            filteredSuggestedPlaces.slice(0, 2).map(place => (
              <Button
                variant="subtle"
                leftIcon={<Map size={14} />}
                key={`suggestion_place_${place.title}`}
                onClick={() => {
                  dispatch(push(`/place/${place.id}`));
                  dispatch(fetchPlaceAlbum(place.id));
                }}
              >
                {place.title}
              </Button>
            ))}
          {filteredSuggestedThings.length > 0 &&
            filteredSuggestedThings.slice(0, 2).map(thing => (
              <Button
                variant="subtle"
                leftIcon={<Tag size={14} />}
                key={`suggestion_thing_${thing.title}`}
                onClick={() => {
                  dispatch(push(`/search`));
                  dispatch(searchPhotos(thing.title));
                }}
              >
                {thing.title}
              </Button>
            ))}
          {filteredSuggestedPeople.length > 0 && (
            <Group>
              {filteredSuggestedPeople.map(person => (
                <PersonAvatar person={person} key={`suggestion_person_${person.text}`} />
              ))}
            </Group>
          )}
          {albumsThingList.length == 0 && searchText.length > 0 && (
            <Button variant="subtle" leftIcon={<Search size={14} />} loading>
              {t("search.loading")}
            </Button>
          )}
        </Stack>
      </Popover>
    </Stack>
  );
};

const PersonAvatar = ({ person }) => {
  const [opened, setOpened] = useState(false);

  return (
    <Popover
      opened={opened}
      onClose={() => setOpened(false)}
      withArrow
      position="bottom"
      target={
        <Avatar
          component={Link}
          to={`/person/${person.key}`}
          onMouseEnter={() => setOpened(true)}
          onMouseLeave={() => setOpened(false)}
          key={`suggestion_person_${person.key}`}
          size={50}
          radius="xl"
          src={serverAddress + person.face_url}
        />
      }
    >
      {person.text}
    </Popover>
  );
};
