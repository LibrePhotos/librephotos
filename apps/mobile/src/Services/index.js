import axios from 'axios'
import handleError from '@/Services/utils/handleError'
import { store } from '@/Store/index'
import AuthUser from '@/Store/Auth/AuthUser'
import { isRefreshTokenExpired } from './Auth/index'

// store.subscribe(listener)

function select(state) {
  return state.auth
}

const instance = axios.create({
  headers: {
    Accept: 'application/json',
    // 'Content-Type': 'application/json',
  },
  timeout: 500,
})

instance.interceptors.response.use(
  response => response,
  function (error) {
    const originalRequest = error.config
    const dispatch = store.dispatch
    const authState = select(store.getState())

    if (
      error.response.status === 401 &&
      !originalRequest._retry &&
      !isRefreshTokenExpired(authState)
    ) {
      console.log('Refreshing Token..')
      originalRequest._retry = true

      const refreshToken = authState.refresh.token
      return instance
        .post('/auth/token/refresh/', {
          refresh: refreshToken,
        })
        .then(response => {
          dispatch(AuthUser.action(response.data))

          axios.defaults.headers.common.Authorization =
            'Bearer ' + response.data.access
          originalRequest.headers.Authorization =
            'Bearer ' + response.data.access
          if (originalRequest.baseURL === originalRequest.url.substring(0, 5)) {
            originalRequest.baseURL = ''
          }
          return instance(originalRequest)
        })
    } else {
      console.log(
        'False Data',
        error.response.status,
        originalRequest._retry,
        isRefreshTokenExpired(authState),
      )
    }

    return Promise.reject(error)
  },
)

instance.interceptors.response.use(
  response => response,
  ({ message, response: { data, status } }) => {
    return handleError({ message, data, status })
  },
)

export default instance
