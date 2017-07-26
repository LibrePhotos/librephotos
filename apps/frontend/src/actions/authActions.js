import {Server} from '../api_client/apiClient'

export function login(username,password) {
  return function(dispatch) {
    dispatch({type:"LOGIN"})
    Server.post(`/token-auth/`, {username:username, password:password})
      .then((response) => {
        dispatch({type: "LOGIN_FULFILLED", payload: response.data.token})
      })
      .catch((err) => {
        dispatch({type: "LOGIN_REJECTED", payload: err})
      })
  }
}

export function logout() {
  return function(dispatch) {
    dispatch({type:"LOGOUT"})
  }
}

//auth.tokens.authentication_token