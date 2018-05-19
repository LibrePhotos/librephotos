export default function reducer(state={
    searchPhotosRes: [],
    searchPhotosResGroupedByDate: [],
    idx2hash:[],
    searchPeopleRes: [],
    searchPlaceAlbumsRes: [],
    searchThingAlbumsRes: [],

    searchingPhotos: false,
    searchedPhotos: false,
    searchingPeople: false,
    searchedPeople: false,
    searchingThingAlbums: false,
    searchedThingAlbums: false,
    searchingPlaceAlbums: false,
    searchedPlaceAlbums: false,

    error: null,
    query: null,
  }, action) {

  switch (action.type) {
    case "SEARCH_PHOTOS_EMPTY_QUERY_ERROR": {
      return {...state, error:"Search query cannot be empty!"}
    }
  	case "SEARCH_PHOTOS": {
  		return {...state, searchPhotoRes: [], searchingPhotos: true, query:action.payload}
  	}

    case "SEARCH_PHOTOS_REJECTED": {
      return { ...state, searchingPhotos: false, error: action.payload}
    }

    case "SEARCH_RES_GROUP_BY_DATE": {
      return { ...state, searchPhotosResGroupedByDate: action.payload}
    }

    case "SEARCH_RES_IDX2HASH": {
      return { ...state, idx2hash: action.payload}
    }

    case "SEARCH_PHOTOS_FULFILLED": {
      return {
        ...state,
        searchingPhotos: false,
        searchedPhotos: true,
        searchPhotosRes: action.payload
      }
    }


    case "SEARCH_PEOPLE": {
  		return {...state, searchPeopleRes: [], searchingPeople: true}
    }
    case "SEARCH_PEOPLE_FULFILLED": {
      return {
        ...state,
        searchingPeople: false,
        searchedPeople: true,
        searchPeopleRes: action.payload
      }
    }
    case "SEARCH_PEOPLE_REJECTED": {
      return { ...state, searchingPeople: false, error: action.payload}
    }




    case "SEARCH_THING_ALBUMS": {
  		return {...state, searchThingAlbumsRes: [], searchingThingAlbums: true}
    }
    case "SEARCH_THING_ALBUMS_FULFILLED": {
      return {
        ...state,
        searchingThingAlbums: false,
        searchedThingAlbums: true,
        searchThingAlbumsRes: action.payload
      }
    }
    case "SEARCH_THING_ALBUMS_REJECTED": {
      return { ...state, searchingPeople: false, error: action.payload}
    }


    case "SEARCH_PLACE_ALBUMS": {
  		return {...state, searchPlaceAlbumsRes: [], searchingPlaceAlbums: true}
    }
    case "SEARCH_PLACE_ALBUMS_FULFILLED": {
      return {
        ...state,
        searchingPlaceAlbums: false,
        searchedPlaceAlbums: true,
        searchPlaceAlbumsRes: action.payload
      }
    }
    case "SEARCH_PLACE_ALBUMS_REJECTED": {
      return { ...state, searchingPlaceAlbums: false, error: action.payload}
    }



    default: {
      return {...state}
    }
  }
}
