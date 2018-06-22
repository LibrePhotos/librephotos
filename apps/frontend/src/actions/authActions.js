import { push } from 'react-router-redux';
import { Server } from '../api_client/apiClient';






export const LOGIN_REQUEST = '@@auth/LOGIN_REQUEST';
export const LOGIN_SUCCESS = '@@auth/LOGIN_SUCCESS';
export const LOGIN_FAILURE = '@@auth/LOGIN_FAILURE';

export const TOKEN_REQUEST = '@@auth/TOKEN_REQUEST';
export const TOKEN_RECEIVED = '@@auth/TOKEN_RECEIVED';
export const TOKEN_FAILURE = '@@auth/TOKEN_FAILURE';

// export const login = (username, password) => ({
//     [RSAA]: {
//         endpoint: serverAddress+'/api/auth/token/obtain/',
//         method: 'POST',
//         body: JSON.stringify({username, password}),
//         headers: { 'Content-Type': 'application/json' },
//         types: [
//             LOGIN_REQUEST, LOGIN_SUCCESS, LOGIN_FAILURE
//         ]
//     }
// })

// export const refreshAccessToken = (token) => ({
//     [RSAA]: {
//         endpoint: serverAddress+'/api/auth/token/refresh/',
//         method: 'POST',
//         body: JSON.stringify({refresh: token}),
//         headers: { 'Content-Type': 'application/json' },
//         types: [
//             TOKEN_REQUEST, TOKEN_RECEIVED, TOKEN_FAILURE
//         ]
//     }
// })


export function signup(username,password,email,firstname,lastname) {
  return function(dispatch) {
    dispatch({type:"SIGNUP"})
    Server.post('/user/', {email:email, 
        username:username, 
        password:password, 
        scan_directory:'initial',
        first_name:firstname,
        last_name:lastname})
      .then((response) => {
        dispatch({type: "SIGNUP_FULFILLED", payload: response.data})
        dispatch(push('/login'))
      })
      .catch((err) => {
        dispatch({type: "SIGNUP_REJECTED", payload: err})
      })
  }
}

export function login(username,password,from) {
  return function(dispatch) {
    dispatch({type:"LOGIN"})
    Server.post('/auth/token/obtain/', {username:username, password:password})
      .then((response) => {
        dispatch({type: "LOGIN_FULFILLED", payload: response.data})
        dispatch(push(from))
      })
      .catch((err) => {
        dispatch({type: "LOGIN_REJECTED", payload: err})
      })
  }
}


export function refreshAccessToken(token) {
  return function(dispatch) {
    dispatch({type:"REFRESH_ACCESS_TOKEN"})
    Server.post('/auth/token/refresh/', {refresh:token})
      .then((response) => {
        dispatch({type: "REFRESH_ACCESS_TOKEN_FULFILLED", payload: response.data})
      })
      .catch((err) => {
        dispatch({type: "REFRESH_ACCESS_TOKEN_REJECTED", payload: err})
      })
  }
}

export function logout() {
  return function(dispatch) {
    dispatch({type:"LOGOUT"})
  }
}

//auth.tokens.authentication_token
