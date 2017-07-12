import axios from "axios";


var Server = axios.create({
  baseURL: 'http://localhost:8000/api/',
  timeout: 10000,
  auth: {username: 'admin',
         password: 'skagnfka'}
});

export function fetchFaces() {
  return function(dispatch) {
    dispatch({type: "FETCH_FACES"});
    /* 
      http://rest.learncode.academy is a public test server, so another user's experimentation can break your tests
      If you get console errors due to bad data:
      - change "reacttest" below to any other username
      - post some tweets to http://rest.learncode.academy/api/yourusername/tweets
    */
    Server.get("faces/?page_size=1")
      .then((response) => {
        dispatch({type: "FETCH_FACES_FULFILLED", payload: response.data.results})
      })
      .catch((err) => {
        dispatch({type: "FETCH_FACES_REJECTED", payload: err})
      })
  }
}

export function deleteFace(face_id) {
  return function(dispatch) {
    dispatch({type: "DELETE_FACE", payload:face_id});
  }
}

export function labelFacePerson(face_id, person_name) {
  return function(dispatch) {
    dispatch({type: "LABEL_FACE_PERSON"});
    Server.patch("faces/{0}/".format(person_name),{"person":{"name":person_name}})
      .then((response) => {
        dispatch({type: "LABEL_FACE_PERSON_FULFILLED", payload: response.data})
      })
  }
}