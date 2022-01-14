import { Server } from "../api_client/apiClient";

export function fetchPublicUserList() {
  return function (dispatch) {
    dispatch({ type: "FETCH_PUBLIC_USER_LIST" });
    Server.get("user/")
      .then((response) => {
        dispatch({
          type: "FETCH_PUBLIC_USER_LIST_FULFILLED",
          payload: response.data.results,
        });
      })
      .catch((err) => {
        dispatch({
          type: "FETCH_PUBLIC_USER_LIST_REJECTED",
        });
      });
  };
}
