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