import axios from "axios";

export var Server = axios.create({
  baseURL: 'http://localhost:8000/api/',
  timeout: 10000,
  auth: {username: 'admin',
         password: 'skagnfka'}
});

export default Server