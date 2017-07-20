import axios from "axios";
import Server from '../api_client/apiClient'

export function fetchPeopleAlbums(person_id) {
  return function(dispatch) {
    dispatch({type: "FETCH_PEOPLE_ALBUMS"});
    Server.get(`albums/person/${person_id}/`)
      .then((response) => {
        dispatch({type: "FETCH_PEOPLE_ALBUMS_FULFILLED", payload: response.data})
      })
      .catch((err) => {
        dispatch({type: "FETCH_PEOPLE_ALBUMS_REJECTED", payload: err})
      })
  }
}


export function generateAutoAlbums() {
	return function(dispatch) {
		dispatch({type: "GENERATE_AUTO_ALBUMS"})
    Server.get("autoalbumgen/")
      .then((response) => {
        dispatch({type: "GENERATE_AUTO_ALBUMS_FULFILLED", payload: response.data})
        dispatch(fetchAutoAlbums())
      })
      .catch((err) => {
        dispatch({type: "GENERATE_AUTO_ALBUMS_REJECTED", payload: err})
      })

	}
}

export function fetchAutoAlbums() {
  return function(dispatch) {
    dispatch({type: "FETCH_AUTO_ALBUMS"});
    Server.get("albums/auto/?page_size=50")
      .then((response) => {
        dispatch({type: "FETCH_AUTO_ALBUMS_FULFILLED", payload: response.data.results})
      })
      .catch((err) => {
        dispatch({type: "FETCH_AUTO_ALBUMS_REJECTED", payload: err})
      })
  }
}

//actions using new list view in backend

export function fetchAutoAlbumsList() {
  return function(dispatch) {
    dispatch({type: "FETCH_AUTO_ALBUMS_LIST"});
    Server.get("albums/auto/list/")
      .then((response) => {
        dispatch({type: "FETCH_AUTO_ALBUMS_LIST_FULFILLED", payload: response.data.results})
      })
      .catch((err) => {
        dispatch({type: "FETCH_AUTO_ALBUMS_LIST_REJECTED", payload: err})
      })
  }
}

export function fetchDateAlbumsList() {
  return function(dispatch) {
    dispatch({type: "FETCH_DATE_ALBUMS_LIST"});
    Server.get("albums/date/list/")
      .then((response) => {
        dispatch({type: "FETCH_DATE_ALBUMS_LIST_FULFILLED", payload: response.data.results})
      })
      .catch((err) => {
        dispatch({type: "FETCH_AUTO_ALBUMS_LIST_REJECTED", payload: err})
      })
  }
}

//actions using new retrieve view in backend

export function fetchAutoAlbumsRetrieve(album_id) {
  return function(dispatch) {
    dispatch({type: "FETCH_AUTO_ALBUMS_RETRIEVE"});
    Server.get("albums/auto/`${album_id}`/")
      .then((response) => {
        dispatch({type: "FETCH_AUTO_ALBUMS_RETRIEVE_FULFILLED", payload: response.data.results})
      })
      .catch((err) => {
        dispatch({type: "FETCH_AUTO_ALBUMS_RETRIEVE_REJECTED", payload: err})
      })
  }
}

export function fetchDateAlbumsRetrieve(album_id) {
  return function(dispatch) {
    dispatch({type: "FETCH_DATE_ALBUMS_RETRIEVE"});
    Server.get("albums/date/`${album_id}`/")
      .then((response) => {
        dispatch({type: "FETCH_DATE_ALBUMS_RETRIEVE_FULFILLED", payload: response.data.results})
      })
      .catch((err) => {
        dispatch({type: "FETCH_AUTO_ALBUMS_RETRIEVE_REJECTED", payload: err})
      })
  }
}
