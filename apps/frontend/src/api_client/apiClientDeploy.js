import axios from "axios";
import store from '../store'
import { isRefreshTokenExpired } from '../reducers/'


store.subscribe(listener)

function select(state) {
 return state.auth
}

function listener() {
 var auth = select(store.getState())
 if (auth.access) {
  // console.log('api client got header')
  axios.defaults.headers.common['Authorization'] = "Bearer " + auth.access.token;
 }
}

export var serverAddress = ''

export var Server = axios.create({
  baseURL: '/api/',
  headers: {
    'Content-Type': 'application/json'
  },
  timeout: 30000,
});



Server.interceptors.request.use(function(request) {
	// console.log('axios sending request',request)
	return request
}, function(error) {
	// console.log('axios error sending request',error)
})


Server.interceptors.response.use(function (response) {
  // console.log('axios got response',response)
  return response;
}, function (error) {
  // console.log('axios retrying')
  const originalRequest = error.config;

  if (error.response.status === 401 && !originalRequest._retry && !isRefreshTokenExpired(store.getState())) {

    originalRequest._retry = true;

    const auth = select(store.getState())
    const refreshToken = auth.refresh.token
    // console.log('retrying')

    // store.dispatch(refreshAccessToken(refreshToken))
    return Server.post(serverAddress+'/auth/token/refresh/', { refresh:refreshToken })
      .then((response) => {
      	store.dispatch({type: "REFRESH_ACCESS_TOKEN_FULFILLED", payload: response.data})
      	// console.log('setting refreshed access token in retry',response.data)
        axios.defaults.headers.common['Authorization'] = 'Bearer ' + response.data.access;
        originalRequest.headers['Authorization'] = 'Bearer ' + response.data.access;
        return Server(originalRequest);
      });
  }

  return Promise.reject(error);
});
export default {serverAddress, Server}
