export default function reducer(state={
    albumsPeople: [],
    fetchingAlbumsPeople: false,
    fetchedAlbumsPeople: false,

    albumsAuto: [],
    fetchingAlbumsAuto: false,
    fetchedAlbumsAuto: false,

    generatingAlbumsAuto: false,
    generatedAlbumsAuto: false,

    albumsAutoList: [],
    fetchingAlbumsAutoList: false,
    fetchedAlbumsAutoList: false,

    error: null,
  }, action) {

  switch (action.type) {
    case "FETCH_PEOPLE_ALBUMS": {
      return {...state, fetchingAlbumsPeople: true}
    }
    case "FETCH_PEOPLE_ALBUMS_REJECTED": {
      return {...state, fetchingAlbumsPeople: false, error: action.payload}
    }
    case "FETCH_PEOPLE_ALBUMS_FULFILLED": {
      var new_album = {...state.albumsPeople}
      new_album[action.payload.id] = action.payload
      return {
        ...state,
        fetchingAlbumsPeople: false,
        fetchedAlbumsPeople: true,
        albumsPeople: new_album
      }
    }


    case "FETCH_AUTO_ALBUMS": {
      return {...state, fetchingAlbumsAuto: true}
    }
    case "FETCH_AUTO_ALBUMS_REJECTED": {
      return {...state, fetchingAlbumsAuto: false, error: action.payload}
    }
    case "FETCH_AUTO_ALBUMS_FULFILLED": {
      return {
        ...state,
        fetchingAlbumsAuto: false,
        fetchedAlbumsAuto: true,
        albumsAuto: action.payload,
      }
    }
  

    case "GENERATE_AUTO_ALBUMS": {
      return {...state, generatingAlbumsAuto: true}
    }
    case "GENERATE_AUTO_ALBUMS_REJECTED": {
      return {...state, generatingAlbumsAuto: false, error: action.payload}
    }
    case "GENERATE_AUTO_ALBUMS_FULFILLED": {
      return {
        ...state,
        generatingAlbumsAuto: false,
        generatedAlbumsAuto: true,
      }
    }

    case "FETCH_AUTO_ALBUMS_LIST": {
      return {...state, fetchingAlbumsAutoList: true}
    }
    case "FETCH_AUTO_ALBUMS_LIST_REJECTED": {
      return {...state, fetchingAlbumsAutoList: false, error: action.payload}
    }
    case "FETCH_AUTO_ALBUMS_LIST_FULFILLED": {
      return {
        ...state,
        fetchingAlbumsAutoList: false,
        fetchedAlbumsAutoList: true,
        albumsAutoList: action.payload
      }
    }




    default: {
      return {...state}
    }
  }
}




// FETCH_AUTO_ALBUMS_LIST
// FETCH_AUTO_ALBUMS_LIST_FULFILLED
// FETCH_AUTO_ALBUMS_LIST_REJECTED