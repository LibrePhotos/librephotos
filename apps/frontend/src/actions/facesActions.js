import axios from "axios";
import Server from '../api_client/apiClient'



export function trainFaces() {
  return function(dispatch) {
    dispatch({type: "TRAIN_FACES"});
    Server.get("trainfaces/")
      .then((response) => {
        dispatch({type: "TRAIN_FACES_FULFILLED", payload: response.data})
        dispatch(fetchInferredFaces())
        dispatch(fetchLabeledFaces())
      })
      .catch((err) => {
        dispatch({type: "TRAIN_FACES_REJECTED", payload: err})
      })
  }
}

export function clusterFaces() {
  return function(dispatch) {
    dispatch({type: "CLUSTER_FACES"});
    Server.get("clusterfaces/")
      .then((response) => {
        dispatch({type: "CLUSTER_FACES_FULFILLED", payload: response.data})
        dispatch(fetchInferredFaces())
        dispatch(fetchLabeledFaces())
      })
      .catch((err) => {
        dispatch({type: "CLUSTER_FACES_REJECTED", payload: err})
      })
  }
}

export function fetchInferredFaces() {
  return function(dispatch) {
    dispatch({type: "FETCH_INFERRED_FACES"});
    Server.get("faces/inferred/")
      .then((response) => {
        dispatch({type: "FETCH_INFERRED_FACES_FULFILLED", payload: response.data.results})
      })
      .catch((err) => {
        dispatch({type: "FETCH_INFERRED_FACES_REJECTED", payload: err})
      })
  }
}

export function fetchLabeledFaces() {
  return function(dispatch) {
    dispatch({type: "FETCH_LABELED_FACES"});
    Server.get("faces/labeled/")
      .then((response) => {
        dispatch({type: "FETCH_LABELED_FACES_FULFILLED", payload: response.data.results})
      })
      .catch((err) => {
        dispatch({type: "FETCH_LABELED_FACES_REJECTED", payload: err})
      })
  }
}

export function fetchFaces() {
  return function(dispatch) {
    dispatch({type: "FETCH_FACES"});
    Server.get("faces/?page_size=20")
      .then((response) => {
        dispatch({type: "FETCH_FACES_FULFILLED", payload: response.data.results})
      })
      .catch((err) => {
        dispatch({type: "FETCH_FACES_REJECTED", payload: err})
      })
  }
}

//fetches a face to label from the server
export function fetchFaceToLabel() {
  return function(dispatch) {
    dispatch({type: "FETCH_FACE_TO_LABEL"});
    Server.get("facetolabel/")
      .then((response) => {
        dispatch({type: "FETCH_FACE_TO_LABEL_FULFILLED", payload: response.data})
      })
      .catch((err) => {
        dispatch({type: "FETCH_FACE_TO_LABEL_REJECTED", payload: err})
      })
  }
}

//loads face to label onclick of the face icons
export function loadFaceToLabel(face) {
  return function(dispatch) {
    dispatch({type: "LOAD_FACE_TO_LABEL",payload:face});
  }
}



export function deleteFaceAndFetchNext(face_id) {
  return function(dispatch) {
    dispatch({type: "DELETE_FACE", payload:face_id});
    Server.delete(`faces/${face_id}/`)
      .then((response)=>{
        dispatch({type:"DELETE_FACE_FULFILLED"})
        dispatch(fetchInferredFaces())
        dispatch(fetchLabeledFaces())
        dispatch(fetchFaceToLabel())
      })
      .catch((err)=>{
        dispatch({type:"DELETE_FACE_REJECTED"})
      })
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
        dispatch({type: "FETCH_FACE_TO_LABEL"});
        Server.get("facetolabel/")
          .then((response2) => {
            dispatch({type: "FETCH_FACE_TO_LABEL_FULFILLED", payload: response2.data})
            dispatch(fetchInferredFaces())
            dispatch(fetchLabeledFaces())
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



