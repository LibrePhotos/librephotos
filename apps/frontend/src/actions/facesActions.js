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
    Server.get("faces/?page_size=20")
      .then((response) => {
        dispatch({type: "FETCH_FACES_FULFILLED", payload: response.data.results})
      })
      .catch((err) => {
        dispatch({type: "FETCH_FACES_REJECTED", payload: err})
      })
  }
}


export function fetchFaceToLabel() {
  return function(dispatch) {
    dispatch({type: "FETCH_FACE_TO_LABEL"});
    /* 
      http://rest.learncode.academy is a public test server, so another user's experimentation can break your tests
      If you get console errors due to bad data:
      - change "reacttest" below to any other username
      - post some tweets to http://rest.learncode.academy/api/yourusername/tweets
    */
    Server.get("facetolabel/")
      .then((response) => {
        dispatch({type: "FETCH_FACE_TO_LABEL_FULFILLED", payload: response.data})
      })
      .catch((err) => {
        dispatch({type: "FETCH_FACE_TO_LABEL_REJECTED", payload: err})
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
    var endpoint = `faces/${face_id}/`
    Server.patch(endpoint,{"person":{"name":person_name}})
      .then((response) => {
        dispatch({type: "LABEL_FACE_PERSON_FULFILLED", payload: response.data})
      })
      .catch((err) => {
        dispatch({type: "LABEL_FACE_PERSON_REJECTED", payload: err})
      })
  }
}


export function labelFacePersonAndFetchNext(face_id, person_name) {
  return function(dispatch) {
    dispatch({type: "LABEL_FACE_PERSON"});
    var endpoint = `faces/${face_id}/`
    Server.patch(endpoint,{"person":{"name":person_name}})
      .then((response1) => {
        dispatch({type: "LABEL_FACE_PERSON_FULFILLED", payload: response1.data})
        Server.get("facetolabel/")
          .then((response2) => {
            dispatch({type: "FETCH_FACE_TO_LABEL_FULFILLED", payload: response2.data})
          })
          .catch((err2) => {
            dispatch({type: "FETCH_FACE_TO_LABEL_REJECTED", payload: err2})
          })
      })
      .catch((err1) => {
        dispatch({type: "LABEL_FACE_PERSON_REJECTED", payload: err1})
      })
  }
}



