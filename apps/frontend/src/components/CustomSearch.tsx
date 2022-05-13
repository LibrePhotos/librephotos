import { Stack, TextInput } from "@mantine/core";
import { useViewportSize } from "@mantine/hooks";
import { push } from "connected-react-router";
import _ from "lodash";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon, Image, Loader, Popup, Segment } from "semantic-ui-react";
import { Search } from "tabler-icons-react";

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
import { TOP_MENU_HEIGHT } from "../ui-constants";
import { SecuredImageJWT } from "./SecuredImage";

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
      <TextInput
        icon={<Search size={14} />}
        width={searchBarWidth}
        onFocus={() => {
          setSearchBarFocused(true);
        }}
        onBlur={() => {
          _.debounce(() => {
            setSearchBarFocused(false);
          }, 200)();
        }}
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
      {searchBarFocused && (
        <div
          style={{
            width: searchBarWidth,
            textAlign: "left",
            zIndex: 120,
            top: TOP_MENU_HEIGHT,
            left: (width - searchBarWidth) / 2.1,
            position: "absolute",
          }}
        >
          {filteredExampleSearchTerms.length > 0 && (
            <Segment attached textAlign="left" style={{ paddingTop: 0, paddingRight: 0, paddingBottom: 0 }}>
              <div
                style={{
                  maxHeight: window.innerHeight / 5,
                  overflowY: "auto",
                }}
              >
                <div style={{ height: 10 }} />
                {filteredExampleSearchTerms.slice(0, 2).map(el => (
                  <p
                    key={`suggestion_${el}`}
                    onClick={() => {
                      dispatch(searchPhotos(el));
                      dispatch(searchPeople(el));
                      dispatch(searchThingAlbums(el));
                      dispatch(searchPlaceAlbums(el));
                      dispatch(push("/search"));
                    }}
                  >
                    <Icon name="search" />
                    {el}
                  </p>
                ))}
                <div style={{ height: 5 }} />
              </div>
            </Segment>
          )}
          {filteredSuggestedUserAlbums.length > 0 && (
            <Segment attached textAlign="left" style={{ paddingTop: 0, paddingRight: 0, paddingBottom: 0 }}>
              <div
                style={{
                  maxHeight: window.innerHeight / 5,
                  overflowY: "auto",
                }}
              >
                <div style={{ height: 10 }} />
                {filteredSuggestedUserAlbums.slice(0, 2).map(album => (
                  <p
                    key={`suggestion_place_${album.title}`}
                    onClick={() => {
                      dispatch(push(`/useralbum/${album.id}`));
                      dispatch(fetchUserAlbum(album.id));
                    }}
                  >
                    <Icon name="bookmark" />
                    {album.title}
                  </p>
                ))}
                <div style={{ height: 5 }} />
              </div>
            </Segment>
          )}
          {filteredSuggestedPlaces.length > 0 && (
            <Segment attached textAlign="left" style={{ paddingTop: 0, paddingRight: 0, paddingBottom: 0 }}>
              <div
                style={{
                  maxHeight: window.innerHeight / 5,
                  overflowY: "auto",
                }}
              >
                <div style={{ height: 10 }} />
                {filteredSuggestedPlaces.slice(0, 2).map(place => (
                  <p
                    key={`suggestion_place_${place.title}`}
                    onClick={() => {
                      dispatch(push(`/place/${place.id}`));
                      dispatch(fetchPlaceAlbum(place.id));
                    }}
                  >
                    <Icon name="map outline" />
                    {place.title}
                  </p>
                ))}
                <div style={{ height: 5 }} />
              </div>
            </Segment>
          )}
          {filteredSuggestedThings.length > 0 && (
            <Segment attached textAlign="left" style={{ paddingTop: 0, paddingRight: 0, paddingBottom: 0 }}>
              <div
                style={{
                  maxHeight: window.innerHeight / 5,
                  overflowY: "auto",
                }}
              >
                <div style={{ height: 10 }} />
                {filteredSuggestedThings.slice(0, 2).map(thing => (
                  <p
                    key={`suggestion_thing_${thing.title}`}
                    onClick={() => {
                      dispatch(push(`/search`));
                      dispatch(searchPhotos(thing.title));
                    }}
                  >
                    <Icon name="tag" />
                    {thing.title}
                  </p>
                ))}
                <div style={{ height: 5 }} />
              </div>
            </Segment>
          )}
          {filteredSuggestedPeople.length > 0 && (
            <Segment attached style={{ padding: 0 }}>
              <div
                style={{
                  maxWidth: searchBarWidth - 5,
                  height: 60,
                  padding: 5,
                  overflow: "hidden",
                }}
              >
                <Image.Group>
                  {filteredSuggestedPeople.map(person => (
                    <Popup
                      inverted
                      content={person.text}
                      trigger={
                        <SecuredImageJWT
                          key={`suggestion_person_${person.key}`}
                          onClick={() => {
                            dispatch(push(`/person/${person.key}`));
                          }}
                          height={50}
                          width={50}
                          circular
                          src={serverAddress + person.face_url}
                        />
                      }
                    />
                  ))}
                </Image.Group>
              </div>
            </Segment>
          )}
          {albumsThingList.length == 0 && searchText.length > 0 && (
            <Segment attached textAlign="left" style={{ paddingTop: 0, paddingRight: 0, paddingBottom: 0 }}>
              <div
                style={{
                  maxHeight: window.innerHeight / 5,
                  overflowY: "auto",
                }}
              >
                {t("search.loading")}
                <Loader inline active size="mini" />
              </div>
            </Segment>
          )}
        </div>
      )}
    </Stack>
  );
};
