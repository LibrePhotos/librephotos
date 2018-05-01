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

export var serverAddress = 'http://192.168.1.100:8000'

export var Server = axios.create({
  baseURL: 'http://192.168.1.100:8000/api/',
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'max-age=6000000'
  },
  auth: {
    username: 'admin',
    password: 'q1W@e3R$'
  },
  timeout: 30000,
});

export default {serverAddress, Server}
