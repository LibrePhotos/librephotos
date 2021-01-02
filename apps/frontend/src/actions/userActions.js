import { Server } from "../api_client/apiClient";


export function fetchUserSelfDetails(user_id) {
  return function(dispatch) {
    dispatch({ type: "FETCH_USER_SELF_DETAILS" });
    Server.get(`/user/${user_id}/`)
      .then(response => {
        dispatch({
          type: "FETCH_USER_SELF_DETAILS_FULFILLED",
          payload: response.data
        });
      })
      .catch(error => {
        dispatch({ type: "FETCH_USER_SELF_DETAILS_REJECTED", payload: error });
      });
  };
}
