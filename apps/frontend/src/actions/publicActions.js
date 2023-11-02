import { Server } from "../api_client/apiClient";
import { UserSchema } from "../store/user/user.zod";

export function fetchPublicUserList() {
  return function (dispatch) {
    dispatch({ type: "FETCH_PUBLIC_USER_LIST" });
    Server.get("user/")
      .then(response => {
        const payload = UserSchema.array().parse(response.data.results);
        dispatch({
          type: "FETCH_PUBLIC_USER_LIST_FULFILLED",
          payload,
        });
      })
      .catch(() => {
        dispatch({
          type: "FETCH_PUBLIC_USER_LIST_REJECTED",
        });
      });
  };
}
