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


    albumsAutoGalleries: {},
    fetchingAlbumsAutoGalleries: false,
    fetchedAlbumsAutoGalleries: false,


    albumsDateList: [],
    fetchingAlbumsDateList: false,
    fetchedAlbumsDateList: false,


    albumsDateGalleries: {},
    fetchingAlbumsDateGalleries: false,
    fetchedAlbumsDateGalleries: false,


    albumsThingList:[],
    fetchingAlbumsThingList: false,
    fetchedAlbumsThingList: false,

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

    case "FETCH_AUTO_ALBUMS_RETRIEVE": {
      return {...state, fetchingAlbumsAutoGalleries: true}
    }
    case "FETCH_AUTO_ALBUMS_RETRIEVE_REJECTED": {
      return {...state, fetchingAlbumsAutoGalleries: false, error: action.payload}
    }
    case "FETCH_AUTO_ALBUMS_RETRIEVE_FULFILLED": {
      var new_album = {...state.albumsAutoGalleries}
      new_album[action.payload.id] = action.payload
      return {
        ...state,
        fetchingAlbumsAutoGalleries: false,
        fetchedAlbumsAutoGalleries: true,
        albumsAutoGalleries: new_album
      }
    }




    case "FETCH_DATE_ALBUMS_LIST": {
      return {...state, fetchingAlbumsDateList: true}
    }
    case "FETCH_DATE_ALBUMS_LIST_REJECTED": {
      return {...state, fetchingAlbumsDateList: false, error: action.payload}
    }
    case "FETCH_DATE_ALBUMS_LIST_FULFILLED": {
      return {
        ...state,
        fetchingAlbumsDateList: false,
        fetchedAlbumsDateList: true,
        albumsDateList: action.payload
      }
    }

    case "FETCH_DATE_ALBUMS_RETRIEVE": {
      return {...state, fetchingAlbumsDateGalleries: true}
    }
    case "FETCH_DATE_ALBUMS_RETRIEVE_REJECTED": {
      return {...state, fetchingAlbumsDateGalleries: false, error: action.payload}
    }
    case "FETCH_DATE_ALBUMS_RETRIEVE_FULFILLED": {
      var new_album = {...state.albumsDateGalleries}
      new_album[action.payload.id] = action.payload
      return {
        ...state,
        fetchingAlbumsDateGalleries: false,
        fetchedAlbumsDateGalleries: true,
        albumsDateGalleries: new_album
      }
    }






    case "FETCH_THING_ALBUMS_LIST": {
      return {...state, fetchingAlbumsThingList: true}
    }
    case "FETCH_THING_ALBUMS_LIST_REJECTED": {
      return {...state, fetchingAlbumsThingList: false, error: action.payload}
    }
    case "FETCH_THING_ALBUMS_LIST_FULFILLED": {
      return {
        ...state,
        fetchingAlbumsThingList: false,
        fetchedAlbumsThingList: true,
        albumsThingList: action.payload
      }
    }







    case "TOGGLE_ALBUM_AUTO_FAVORITE": {
      return {...state}
    }
    case "TOGGLE_ALBUM_AUTO_FAVORITE_REJECTED": {
      return {...state}
    }
    case "TOGGLE_ALBUM_AUTO_FAVORITE_FULFILLED": {
      var new_album = {...state.albumsAutoGalleries}
      new_album[action.payload.id] = action.payload

      var new_album_list = [...state.albumsAutoList]
      console.log(new_album_list)

      var index = -1

      for (var i=0;i<new_album_list.length;i++){
        if (new_album_list[i].id == action.payload.id) {
          index = i
        }
      }

      if (index !== -1) {
          new_album_list[index] = action.payload;
      }


      return {
        ...state,
        fetchingAlbumsAutoGalleries: false,
        fetchedAlbumsAutoGalleries: true,
        albumsAutoGalleries: new_album,
        albumsAutoList: new_album_list
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


// TOGGLE_ALBUM_AUTO_FAVORITE
// TOGGLE_ALBUM_AUTO_FAVORITE_FULFILLED
// TOGGLE_ALBUM_AUTO_FAVORITE_REJECTED