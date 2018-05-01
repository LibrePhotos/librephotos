import axios from "axios";
import {Server} from '../api_client/apiClient'

export function scanPhotos() {
  return function(dispatch) {
    dispatch({type: "SCAN_PHOTOS"});
    Server.get(`scanphotos/`)
      .then((response) => {
        dispatch({type: "SCAN_PHOTOS_FULFILLED", payload: response.data})
      })
      .catch((err) => {
        dispatch({type: "SCAN_PHOTOS_REJECTED", payload: err})
      })
  }
}

export function fetchPhotos() {
  return function(dispatch) {
    dispatch({type:"FETCH_PHOTOS"});
    Server.get('photos/',{timeout:100000})
      .then((response) => {
        dispatch({type:"FETCH_PHOTOS_FULFILLED",payload: response.data.results})
      }) 
      .catch((err) => {
        dispatch({type:"FETCH_PHOTOS_REJECTED",payload: err})        
      })
  }
}

export function fetchPhotoDetail(image_hash) {
  return function(dispatch) {
    dispatch({type:"FETCH_PHOTO_DETAIL"});
    Server.get(`photos/${image_hash}/`,{timeout:100000})
      .then((response) => {
        console.log(response)
        dispatch({type:"FETCH_PHOTO_DETAIL_FULFILLED",payload: response.data})
      }) 
      .catch((err) => {
        console.log(image_hash)
        dispatch({type:"FETCH_PHOTO_DETAIL_REJECTED",payload: err})        
      })
  }
}



export function simpleFetchPhotos() {
  return function(dispatch) {
    dispatch({type:"FETCH_PHOTOS"});
    Server.get('photos/',{timeout:100000})
      .then((response) => {
        dispatch({type:"FETCH_PHOTOS_FULFILLED",payload: response.data.results})
      }) 
      .catch((err) => {
        dispatch({type:"FETCH_PHOTOS_REJECTED",payload: err})        
      })
  }
}




