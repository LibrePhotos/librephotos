import axios from "axios";

import { isRefreshTokenExpired } from "../store/auth/authSelectors";
import { store } from "../store/store";

export const serverAddress = "";
// This is a dirty hack. Grabs current host for when sharing. URL handling needs cleaned up. DW 12-13-20
export const shareAddress = window.location.host;

export const Server = axios.create({
  baseURL: "/api/",
  headers: {
    "Content-Type": "application/json",
  },
  withCredentials: true,
  timeout: 30000,
});

Server.interceptors.request.use(
  config => {
    const { auth } = store.getState();
    const accessToken = auth.access.token;
    if (accessToken) {
      // eslint-disable-next-line no-param-reassign
      config.headers.Authorization = `Bearer ${accessToken}`;
    }
    return config;
  },
  error => Promise.reject(error)
);

Server.interceptors.response.use(
  response => response,
  error => {
    const originalRequest = error.config;
    if (error.response.status === 401 && !originalRequest.internalRetry && !isRefreshTokenExpired(store.getState())) {
      originalRequest.internalRetry = true;

      const { auth } = store.getState();
      const refreshToken = auth.refresh.token;
      return Server.post(`${serverAddress}/auth/token/refresh/`, {
        refresh: refreshToken,
      }).then(response => {
        store.dispatch({
          type: "REFRESH_ACCESS_TOKEN_FULFILLED",
          payload: response.data,
        });
        Server.defaults.headers.common.Authorization = `Bearer ${response.data.access}`;
        originalRequest.headers.Authorization = `Bearer ${response.data.access}`;
        if (originalRequest.baseURL === originalRequest.url.substring(0, 5)) {
          originalRequest.baseURL = "";
        }
        return Server(originalRequest);
      });
    }

    return Promise.reject(error);
  }
);
export default { serverAddress, Server, shareAddress };
