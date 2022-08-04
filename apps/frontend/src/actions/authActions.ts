import { push } from "redux-first-history";

import { api } from "../api_client/api";
import { Server } from "../api_client/apiClient";
import type { AppDispatch } from "../store/store";

export const LOGIN_REQUEST = "@@auth/LOGIN_REQUEST";
export const LOGIN_SUCCESS = "@@auth/LOGIN_SUCCESS";
export const LOGIN_FAILURE = "@@auth/LOGIN_FAILURE";

export const TOKEN_REQUEST = "@@auth/TOKEN_REQUEST";
export const TOKEN_RECEIVED = "@@auth/TOKEN_RECEIVED";
export const TOKEN_FAILURE = "@@auth/TOKEN_FAILURE";

export function signup(
  username: string,
  password: string,
  email: string,
  firstname: string,
  lastname: string,
  is_superuser: boolean,
  dispatch: AppDispatch,
  noPush: boolean = false,
  scan_directory: string = "initial"
) {
  if (!scan_directory) {
    scan_directory = "initial";
  }
  dispatch(
    api.endpoints.signUp.initiate({
      username: username,
      email: email,
      password: password,
      scan_directory: scan_directory,
      first_name: firstname,
      last_name: lastname,
      is_superuser: is_superuser,
    })
  ).then(() => {
    if (!noPush) {
      dispatch(push("/login"));
    }
  });
}

export function login(username: string, password: string, from: any, dispatch: AppDispatch) {
  dispatch({ type: "LOGIN" });
  Server.post("/auth/token/obtain/", {
    username: username,
    password: password,
  })
    .then(response => {
      dispatch({ type: "LOGIN_FULFILLED", payload: response.data });
      dispatch(push(from));
    })
    .catch(err => {
      dispatch({ type: "LOGIN_REJECTED", payload: err });
    });
}

export function refreshAccessToken(token: any, dispatch: AppDispatch) {
  dispatch({ type: "REFRESH_ACCESS_TOKEN" });
  Server.post("/auth/token/refresh/", { refresh: token })
    .then(response => {
      dispatch({
        type: "REFRESH_ACCESS_TOKEN_FULFILLED",
        payload: response.data,
      });
    })
    .catch(err => {
      dispatch({ type: "REFRESH_ACCESS_TOKEN_REJECTED", payload: err });
    });
}

export function logout(dispatch: AppDispatch) {
  dispatch({ type: "LOGOUT" });
}
export {};
