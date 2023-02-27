import axios from 'axios'
import handleError from '@/Services/utils/handleError'
import { store } from '@/Store/store'
import { isRefreshTokenExpired } from '@/Store/Auth/authSelectors'
import { tokenReceived } from '@/Store/Auth/authSlice'

const instance = axios.create({
  headers: {
    Accept: 'application/json',
  },
  timeout: 500,
  withCredentials: true,
  xsrfHeaderName: 'X-CSRFToken',
  xsrfCookieName: 'csrftoken',
})

instance.interceptors.request.use(request => {
  request.baseURL = store.getState().config.baseurl + '/api'
  return request
})

instance.interceptors.response.use(
  response => response,
  error => {
    const originalRequest = error.config
    if (
      error.response.status === 401 &&
      !originalRequest._retry &&
      !isRefreshTokenExpired(store.getState())
    ) {
      originalRequest._retry = true
      const { auth } = store.getState()
      const refreshToken = auth.refresh?.token
      return instance
        .post('/auth/token/refresh/', {
          refresh: refreshToken,
        })
        .then(response => {
          store.dispatch(tokenReceived(response.data))
          instance.defaults.headers.common.Authorization = `Bearer ${response.data.access}`
          originalRequest.headers.Authorization = `Bearer ${response.data.access}`
          return instance(originalRequest)
        })
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
