import { Avatar, Button, Group, Loader, Menu, Popover, Stack, TextInput } from "@mantine/core";
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
    if (searchText) {
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
  }, [searchText]);

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
    <Menu
      style={{
        width: searchBarWidth,
      }}
      control={
        <TextInput
          icon={<Search size={14} />}
          onKeyDown={event => {
            switch (event.keyCode) {
              case ENTER_KEY:
                dispatch(searchPhotos(searchText));
                dispatch(push("/search"));
                break;
              default:
                break;
            }
          }}
          onChange={handleChange}
          placeholder={exampleSearchTerm}
        />
      }
    >
      {filteredExampleSearchTerms.length > 0 &&
        filteredExampleSearchTerms.slice(0, 2).map(el => (
          <Menu.Item
            component={Link}
            to="/search"
            icon={<Search size={14} />}
            key={`suggestion_${el}`}
            onClick={() => {
              dispatch(searchPhotos(el));
              dispatch(searchPeople(el));
              dispatch(searchThingAlbums(el));
              dispatch(searchPlaceAlbums(el));
            }}
          >
            {el}
          </Menu.Item>
        ))}
      {filteredSuggestedUserAlbums.length > 0 &&
        filteredSuggestedUserAlbums.slice(0, 2).map(album => (
          <Menu.Item
            component={Link}
            to={`/useralbum/${album.id}`}
            icon={<Album size={14} />}
            key={`suggestion_place_${album.title}`}
          >
            {album.title}
          </Menu.Item>
        ))}
      {filteredSuggestedPlaces.length > 0 &&
        filteredSuggestedPlaces.slice(0, 2).map(place => (
          <Menu.Item
            component={Link}
            to={`/place/${place.id}`}
            icon={<Map size={14} />}
            key={`suggestion_place_${place.title}`}
          >
            {place.title}
          </Menu.Item>
        ))}
      {filteredSuggestedThings.length > 0 &&
        filteredSuggestedThings.slice(0, 2).map(thing => (
          <Menu.Item
            component={Link}
            to={`/thing/${thing.id}`}
            icon={<Tag size={14} />}
            key={`suggestion_thing_${thing.title}`}
          >
            {thing.title}
          </Menu.Item>
        ))}
      {filteredSuggestedPeople.length > 0 && (
        <Group>
          {filteredSuggestedPeople.map(person => (
            <PersonAvatar person={person} key={`suggestion_person_${person.text}`} />
          ))}
        </Group>
      )}
      {albumsThingList.length == 0 && searchText.length > 0 && (
        <Menu.Item icon={<Search size={14} />}>
          <Group>
            <Loader size={14} />
            {t("search.loading")}
          </Group>
        </Menu.Item>
      )}
    </Menu>
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
