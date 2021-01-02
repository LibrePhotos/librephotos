import { Server } from "../api_client/apiClient";


export function fetchUserPublicPhotos(userName) {
  return function(dispatch) {
    dispatch({ type: "FETCH_USER_PUBLIC_PHOTOS" });
    Server.get(`photos/public/?username=${userName.toLowerCase()}`)
      .then(response => {
        dispatch({
          type: "FETCH_USER_PUBLIC_PHOTOS_FULFILLED",
          payload: { user: userName, photos: response.data.results }
        });
      })
      .catch(err => {
        dispatch({ type: "FETCH_USER_PUBLIC_PHOTOS_REJECTED" });
      });
  };
}

export function fetchPublicUserList() {
  return function(dispatch) {
    dispatch({ type: "FETCH_PUBLIC_USER_LIST" });
    Server.get("user/")
      .then(response => {
        dispatch({
          type: "FETCH_PUBLIC_USER_LIST_FULFILLED",
          payload: response.data.results
        });
      })
      .catch(err => {
        dispatch({
          type: "FETCH_PUBLIC_USER_LIST_REJECTED"
        });
      });
  };
}
