import axios from "axios";

import store from '../store'
store.subscribe(listener)

function select(state) {
  return state.auth.jwtToken
}

function listener() {
  let token = select(store.getState())
  axios.defaults.headers.common['Authorization'] = token;
}

export var serverAddress = 'http://localhost:8000'

export var Server = axios.create({
  baseURL: 'http://localhost:8000/api/',
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000,
});

export default {serverAddress, Server}