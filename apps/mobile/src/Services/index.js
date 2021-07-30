import axios from 'axios'
import handleError from '@/Services/utils/handleError'
import { Config } from '@/Config'

function select(state) {
  return state.auth
}

function listener() {
  var auth = select(store.getState())
  if (auth.access) {
    axios.defaults.headers.common.Authorization = 'Bearer ' + auth.access.token
  }
}

const instance = axios.create({
  baseURL: Config.API_URL,
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  },
  timeout: 3000,
})

instance.interceptors.response.use(
  response => response,
  ({ message, response: { data, status } }) => {
    return handleError({ message, data, status })
  },
)

instance.interceptors.response.use(
  response => response,
  function (error) {
    const originalRequest = error.config

    if (
      error.response.status === 401 &&
      !originalRequest._retry &&
      !isRefreshTokenExpired(store.getState())
    ) {
      originalRequest._retry = true

      const auth = select(store.getState())
      const refreshToken = auth.refresh.token
      return axios
        .post(Config.API_UR + '/auth/token/refresh/', {
          refresh: refreshToken,
        })
        .then(response => {
          store.dispatch({
            type: 'REFRESH_ACCESS_TOKEN_FULFILLED',
            payload: response.data,
          })
          axios.defaults.headers.common.Authorization =
            'Bearer ' + response.data.access
          originalRequest.headers.Authorization =
            'Bearer ' + response.data.access
          if (originalRequest.baseURL === originalRequest.url.substring(0, 5)) {
            originalRequest.baseURL = ''
          }
          return instance(originalRequest)
        })
    }

    return Promise.reject(error)
  },
)
export default instance
