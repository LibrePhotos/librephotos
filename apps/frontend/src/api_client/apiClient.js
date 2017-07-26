import axios from "axios";

export var serverAddress = 'http://192.168.1.100:8000'

export var Server = axios.create({
  baseURL: 'http://192.168.1.100:8000/api/',
  timeout: 10000,
  auth: {username: 'admin',
         password: 'q1W@e3R$'}
});

export default {serverAddress, Server}