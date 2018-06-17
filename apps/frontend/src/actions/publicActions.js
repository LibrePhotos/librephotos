import { notify } from "reapop";
import { Server } from "../api_client/apiClient";
import { fetchPeople } from "./peopleActions";

export function fetchUserPublicPhotos(userName) {
  return function(dispatch) {
    dispatch({ type: "FETCH_USER_PUBLIC_PHOTOS" });
    Server.get(`photos/public/?username=${userName.toLowerCase()}`)
      .then(response => {
        dispatch({
          type: "FETCH_USER_PUBLIC_PHOTOS_FULFILLED",
          payload: {user:userName,photos:response.data.results}
        });
        console.log(response);
      })
      .catch(err => {
        dispatch({ type: "FETCH_USER_PUBLIC_PHOTOS_REJECTED" });
        console.log(err);
      });
  };
}
