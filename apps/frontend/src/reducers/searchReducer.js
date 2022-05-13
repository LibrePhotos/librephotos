import { SEARCH_EMPTY_QUERY_ERROR, SEARCH_PHOTOS, SEARCH_PHOTOS_REJECTED } from "../actions/searchActions";

export default function reducer(
  state = {
    searchPeopleRes: [],
    searchPlaceAlbumsRes: [],
    searchThingAlbumsRes: [],

    searchingPeople: false,
    searchedPeople: false,
    searchingThingAlbums: false,
    searchedThingAlbums: false,
    searchingPlaceAlbums: false,
    searchedPlaceAlbums: false,

    error: null,
    query: "",
  },
  action
) {
  switch (action.type) {
    case SEARCH_EMPTY_QUERY_ERROR: {
      return { ...state, error: "Search query cannot be empty!" };
    }

    case SEARCH_PHOTOS: {
      return { ...state, query: action.payload };
    }

    case SEARCH_PHOTOS_REJECTED: {
      return { ...state, error: action.payload, query: "" };
    }

    case "SEARCH_PEOPLE": {
      return { ...state, searchPeopleRes: [], searchingPeople: true };
    }
    case "SEARCH_PEOPLE_FULFILLED": {
      return {
        ...state,
        searchingPeople: false,
        searchedPeople: true,
        searchPeopleRes: action.payload,
      };
    }
    case "SEARCH_PEOPLE_REJECTED": {
      return { ...state, searchingPeople: false, error: action.payload };
    }

    case "SEARCH_THING_ALBUMS": {
      return { ...state, searchThingAlbumsRes: [], searchingThingAlbums: true };
    }
    case "SEARCH_THING_ALBUMS_FULFILLED": {
      return {
        ...state,
        searchingThingAlbums: false,
        searchedThingAlbums: true,
        searchThingAlbumsRes: action.payload,
      };
    }
    case "SEARCH_THING_ALBUMS_REJECTED": {
      return { ...state, searchingPeople: false, error: action.payload };
    }

    case "SEARCH_PLACE_ALBUMS": {
      return { ...state, searchPlaceAlbumsRes: [], searchingPlaceAlbums: true };
    }
    case "SEARCH_PLACE_ALBUMS_FULFILLED": {
      return {
        ...state,
        searchingPlaceAlbums: false,
        searchedPlaceAlbums: true,
        searchPlaceAlbumsRes: action.payload,
      };
    }
    case "SEARCH_PLACE_ALBUMS_REJECTED": {
      return { ...state, searchingPlaceAlbums: false, error: action.payload };
    }

    default: {
      return { ...state };
    }
  }
}
