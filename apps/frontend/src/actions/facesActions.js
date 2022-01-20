import { notify } from "reapop";
import { Server } from "../api_client/apiClient";

export function setFacesPersonLabel(faceIDs, personName) {
  return function (dispatch) {
    dispatch({ type: "SET_FACES_PERSON_LABEL" });
    Server.post("labelfaces/", { person_name: personName, face_ids: faceIDs })
      .then((response) => {
        dispatch({
          type: "SET_FACES_PERSON_LABEL_FULFILLED",
          payload: response.data.results,
        });
        dispatch(
          notify({
            message: `${faceIDs.length} face(s) were successfully labeled as person "${personName}"`,
            title: "Face label",
            status: "success",
            dismissible: true,
            dismissAfter: 3000,
            position: "br",
          })
        );
      })
      .catch((err) => {});
  };
}

export function deleteFaces(faceIDs) {
  return function (dispatch) {
    dispatch({ type: "DELETE_FACES" });
    Server.post("deletefaces/", { face_ids: faceIDs })
      .then((response) => {
        dispatch({
          type: "DELETE_FACES_FULFILLED",
          payload: response.data.results,
        });
        dispatch(
          notify({
            message: `${response.data.results.length} face(s) were successfully deleted`,
            title: "Face delete",
            status: "success",
            dismissible: true,
            dismissAfter: 3000,
            position: "br",
          })
        );
      })
      .catch((err) => {});
  };
}

export function trainFaces() {
  return function (dispatch) {
    dispatch({ type: "TRAIN_FACES" });
    dispatch({ type: "SET_WORKER_AVAILABILITY", payload: false });
    dispatch({
      type: "SET_WORKER_RUNNING_JOB",
      payload: { job_type_str: "Train Faces" },
    });

    dispatch(
      notify({
        message: `Training started`,
        title: "Face training",
        status: "success",
        dismissible: true,
        dismissAfter: 3000,
        position: "br",
      })
    );
    Server.get("trainfaces/", { timeout: 30000 })
      .then((response) => {
        dispatch({ type: "TRAIN_FACES_FULFILLED", payload: response.data });
      })
      .catch((err) => {
        dispatch({ type: "TRAIN_FACES_REJECTED", payload: err });
      });
  };
}

// reusing training faces reducers since they are of similar nature
export function rescanFaces() {
  return function (dispatch) {
    dispatch({ type: "TRAIN_FACES" });
    dispatch({ type: "SET_WORKER_AVAILABILITY", payload: false });
    dispatch({
      type: "SET_WORKER_RUNNING_JOB",
      payload: { job_type_str: "Scan Faces" },
    });

    dispatch(
      notify({
        message: `Scanning started`,
        title: "Face scanning",
        status: "success",
        dismissible: true,
        dismissAfter: 3000,
        position: "br",
      })
    );
    Server.get("scanfaces/", { timeout: 30000 })
      .then((response) => {
        dispatch({ type: "TRAIN_FACES_FULFILLED", payload: response.data });
      })
      .catch((err) => {
        dispatch({ type: "TRAIN_FACES_REJECTED", payload: err });
      });
  };
}

export function clusterFaces(dispatch) {
  dispatch({ type: "CLUSTER_FACES" });
  Server.get("clusterfaces/")
    .then((response) => {
      dispatch({ type: "CLUSTER_FACES_FULFILLED", payload: response.data });
    })
    .catch((err) => {
      dispatch({ type: "CLUSTER_FACES_REJECTED", payload: err });
    });
}

export function fetchInferredFaces() {
  return function (dispatch) {
    dispatch({ type: "FETCH_INFERRED_FACES" });
    Server.get("faces/inferred/")
      .then((response) => {
        dispatch({
          type: "FETCH_INFERRED_FACES_FULFILLED",
          payload: response.data.results,
        });
      })
      .catch((err) => {
        dispatch({ type: "FETCH_INFERRED_FACES_REJECTED", payload: err });
      });
  };
}

export function fetchLabeledFaces() {
  return function (dispatch) {
    dispatch({ type: "FETCH_LABELED_FACES" });
    Server.get("faces/labeled/")
      .then((response) => {
        dispatch({
          type: "FETCH_LABELED_FACES_FULFILLED",
          payload: response.data.results,
        });
      })
      .catch((err) => {
        dispatch({ type: "FETCH_LABELED_FACES_REJECTED", payload: err });
      });
  };
}

export function fetchFaces() {
  return function (dispatch) {
    dispatch({ type: "FETCH_FACES" });
    Server.get("faces/?page_size=20")
      .then((response) => {
        dispatch({
          type: "FETCH_FACES_FULFILLED",
          payload: response.data.results,
        });
      })
      .catch((err) => {
        dispatch({ type: "FETCH_FACES_REJECTED", payload: err });
      });
  };
}

// fast face list views
export function fetchInferredFacesList() {
  return function (dispatch) {
    dispatch({ type: "FETCH_INFERRED_FACES_LIST" });
    Server.get("faces/inferred/list/")
      .then((response) => {
        dispatch({
          type: "FETCH_INFERRED_FACES_LIST_FULFILLED",
          payload: response.data.results,
        });
      })
      .catch((err) => {
        dispatch({ type: "FETCH_INFERRED_FACES_LIST_REJECTED", payload: err });
      });
  };
}

export function fetchLabeledFacesList() {
  return function (dispatch) {
    dispatch({ type: "FETCH_LABELED_FACES_LIST" });
    Server.get("faces/labeled/list/")
      .then((response) => {
        dispatch({
          type: "FETCH_LABELED_FACES_LIST_FULFILLED",
          payload: response.data.results,
        });
      })
      .catch((err) => {
        dispatch({ type: "FETCH_LABELED_FACES_LIST_REJECTED", payload: err });
      });
  };
}

export function fetchFacesList() {
  return function (dispatch) {
    dispatch({ type: "FETCH_FACES_LIST" });
    Server.get("faces/list/")
      .then((response) => {
        dispatch({
          type: "FETCH_FACES_LIST_FULFILLED",
          payload: response.data.results,
        });
      })
      .catch((err) => {
        dispatch({ type: "FETCH_FACES_LIST_REJECTED", payload: err });
      });
  };
}
export function labelFacePerson(face_id, person_name) {
  return function (dispatch) {
    dispatch({ type: "LABEL_FACE_PERSON" });
    var endpoint = `faces/${face_id}/`;
    Server.patch(endpoint, { person: { name: person_name } })
      .then((response) => {
        dispatch({
          type: "LABEL_FACE_PERSON_FULFILLED",
          payload: response.data,
        });
      })
      .catch((err) => {
        dispatch({ type: "LABEL_FACE_PERSON_REJECTED", payload: err });
      });
  };
}
