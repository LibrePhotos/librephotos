import { Server } from "../api_client/apiClient";

export function fetchUserSelfDetails(user_id) {
  return function (dispatch) {
    dispatch({ type: "FETCH_USER_SELF_DETAILS" });
    Server.get(`/user/${user_id}/`)
      .then((response) => {
        dispatch({
          type: "FETCH_USER_SELF_DETAILS_FULFILLED",
          payload: response.data,
        });
      })
      .catch((error) => {
        dispatch({ type: "FETCH_USER_SELF_DETAILS_REJECTED", payload: error });
      });
  };
}

// get the default rules from the backend
export function fetchDefaultRules(dispatch) {
  console.log("fetchDefaultRules");
  dispatch({ type: "FETCH_DEFAULT_RULES" });
  Server.get("/defaultrules/")
    .then((response) => {
      console.log(response);
      dispatch({
        type: "FETCH_DEFAULT_RULES_FULFILLED",
        payload: response.data,
      });
    })
    .catch((error) => {
      dispatch({ type: "FETCH_DEFAULT_RULES_REJECTED", payload: error });
    });
}
