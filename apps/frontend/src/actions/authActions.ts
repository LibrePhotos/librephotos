import { push } from "connected-react-router";
import { Server } from "../api_client/apiClient";
import { AppDispatch } from "../store/store";
import { fetchUserList } from "./utilActions";

export const LOGIN_REQUEST = "@@auth/LOGIN_REQUEST";
export const LOGIN_SUCCESS = "@@auth/LOGIN_SUCCESS";
export const LOGIN_FAILURE = "@@auth/LOGIN_FAILURE";

export const TOKEN_REQUEST = "@@auth/TOKEN_REQUEST";
export const TOKEN_RECEIVED = "@@auth/TOKEN_RECEIVED";
export const TOKEN_FAILURE = "@@auth/TOKEN_FAILURE";

export function signup(
  username: String,
  password: String,
  email: String,
  firstname: String,
  lastname: String,
  is_superuser: Boolean,
  dispatch: AppDispatch
) {
  dispatch({ type: "SIGNUP" });
  Server.post("/user/", {
    email: email,
    username: username,
    password: password,
    scan_directory: "initial",
    first_name: firstname,
    last_name: lastname,
    is_superuser: is_superuser,
  })
    .then((response) => {
      dispatch({ type: "SIGNUP_FULFILLED", payload: response.data });
      // @ts-ignore
      dispatch(fetchUserList());
      dispatch(push("/login"));
    })
    .catch((err) => {
      dispatch({ type: "SIGNUP_REJECTED", payload: err });
    });
}

export function login(username: String, password: String, from: any, dispatch: AppDispatch) {
  dispatch({ type: "LOGIN" });
  Server.post("/auth/token/obtain/", {
    username: username,
    password: password,
  })
    .then((response) => {
      dispatch({ type: "LOGIN_FULFILLED", payload: response.data });
      dispatch(push(from));
    })
    .catch((err) => {
      dispatch({ type: "LOGIN_REJECTED", payload: err });
    });
}

export function refreshAccessToken(token: any, dispatch: AppDispatch) {
  dispatch({ type: "REFRESH_ACCESS_TOKEN" });
  Server.post("/auth/token/refresh/", { refresh: token })
    .then((response) => {
      dispatch({
        type: "REFRESH_ACCESS_TOKEN_FULFILLED",
        payload: response.data,
      });
    })
    .catch((err) => {
      dispatch({ type: "REFRESH_ACCESS_TOKEN_REJECTED", payload: err });
    });
}

export function logout(dispatch: AppDispatch) {
  dispatch({ type: "LOGOUT" });
}
