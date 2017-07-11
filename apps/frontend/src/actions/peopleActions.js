import axios from "axios";


var Server = axios.create({
  baseURL: 'http://localhost:8000/api/',
  timeout: 10000,
  auth: {username: 'admin',
         password: 'skagnfka'}
});

export function fetchPeople() {
  return function(dispatch) {
    dispatch({type: "FETCH_PEOPLE"});
    /* 
      http://rest.learncode.academy is a public test server, so another user's experimentation can break your tests
      If you get console errors due to bad data:
      - change "reacttest" below to any other username
      - post some tweets to http://rest.learncode.academy/api/yourusername/tweets
    */
    Server.get("persons/")
      .then((response) => {
        dispatch({type: "FETCH_PEOPLE_FULFILLED", payload: response.data.results})
      })
      .catch((err) => {
        dispatch({type: "FETCH_PEOPLE_REJECTED", payload: err})
      })
  }
}