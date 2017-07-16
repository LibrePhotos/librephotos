export default function reducer(state={
    albumsPeople: [],
    fetchingAlbumsPeople: false,
    fetchedAlbumsPeople: false,

    albumsAuto: [],
    fetchingAlbumsAuto: false,
    fetchedAlbumsAuto: false,


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
      return {
        ...state,
        fetchingAlbumsPeople: false,
        fetchedAlbumsPeople: true,
        albumsPeople: action.payload,
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
  



    default: {
      return {...state}
    }
  }
}

