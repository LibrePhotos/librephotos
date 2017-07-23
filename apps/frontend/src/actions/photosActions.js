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
    Server.get('photos/?page_size=10000',{timeout:100000})
      .then((response) => {
        dispatch({type:"FETCH_PHOTOS_FULFILLED",payload: response.data.results})
      }) 
      .catch((err) => {
        dispatch({type:"FETCH_PHOTOS_REJECTED",payload: err})        
      })
  }
}