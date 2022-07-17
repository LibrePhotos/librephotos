import { showNotification } from "@mantine/notifications";

import { Server } from "../api_client/apiClient";
import i18n from "../i18n";
import {
  ClusterFaces,
  DeleteFacesResponse,
  FaceList,
  ScanFacesResponse,
  SetFacesLabelResponse,
  TrainFacesResponse,
} from "./facesActions.types";

enum FacesActions {
  SET_FACES_PERSON_LABEL = "set-faces-person-label",
  SET_FACES_PERSON_LABEL_FULFILLED = "set-faces-person-label-fulfilled",
  DELETE_FACES = "delete-faces",
  DELETE_FACES_FULFILLED = "delete-faces-fulfilled",
  TRAIN_FACES = "train-faces",
  SET_WORKER_AVAILABILITY = "set-worker-availability",
  SET_WORKER_RUNNING_JOB = "set-worker-running-job",
  TRAIN_FACES_FULFILLED = "train-faces-fulfilled",
  TRAIN_FACES_REJECTED = "train-faces-rejected",
  CLUSTER_FACES = "cluster-faces",
  CLUSTER_FACES_FULFILLED = "cluster-faces-fulfilled",
  CLUSTER_FACES_REJECTED = "cluster-faces-rejected",
  FETCH_INFERRED_FACES_LIST = "fetch-inferred-faces-list",
  FETCH_INFERRED_FACES_LIST_FULFILLED = "fetch-inferred-faces-list-fulfilled",
  FETCH_INFERRED_FACES_LIST_REJECTED = "fetch-inferred-faces-list-rejected",
  FETCH_LABELED_FACES_LIST = "fetch-labeled-faces-list",
  FETCH_LABELED_FACES_LIST_FULFILLED = "fetch-labeled-faces-list-fulfilled",
  FETCH_LABELED_FACES_LIST_REJECTED = "fetch-labeled-faces-list-rejected",
}

export function setFacesPersonLabel(faceIDs, personName) {
  return function (dispatch) {
    dispatch({ type: FacesActions.SET_FACES_PERSON_LABEL });
    Server.post("labelfaces/", { person_name: personName, face_ids: faceIDs })
      .then(response => {
        const data = SetFacesLabelResponse.parse(response.data);
        dispatch({
          type: FacesActions.SET_FACES_PERSON_LABEL_FULFILLED,
          payload: response.data.results,
        });
        showNotification({
          message: i18n.t<string>("toasts.addfacestoperson", {
            numberOfFaces: faceIDs.length,
            personName: personName,
          }),
          title: i18n.t<string>("toasts.addfacestopersontitle"),
          color: "teal",
        });
      })
      .catch(err => {
        console.error(err);
      });
  };
}

export function deleteFaces(faceIDs) {
  return function (dispatch) {
    dispatch({ type: FacesActions.DELETE_FACES });
    Server.post("deletefaces/", { face_ids: faceIDs })
      .then(response => {
        const data = DeleteFacesResponse.parse(response.data);
        dispatch({
          type: FacesActions.DELETE_FACES_FULFILLED,
          payload: response.data.results,
        });
        showNotification({
          message: i18n.t<string>("toasts.deletefaces", {
            numberOfFaces: faceIDs.length,
          }),
          title: i18n.t<string>("toasts.deletefacestitle"),
          color: "teal",
        });
      })
      .catch(err => {
        console.error(err);
      });
  };
}

export function trainFaces() {
  return function (dispatch) {
    dispatch({ type: FacesActions.TRAIN_FACES });
    dispatch({ type: FacesActions.SET_WORKER_AVAILABILITY, payload: false });
    dispatch({
      type: FacesActions.SET_WORKER_RUNNING_JOB,
      payload: { job_type_str: "Train Faces" },
    });
    showNotification({
      message: i18n.t<string>("toasts.trainingstarted"),
      title: i18n.t<string>("toasts.trainingstartedtitle"),
      color: "teal",
    });
    Server.get("trainfaces/", { timeout: 30000 })
      .then(response => {
        const data = TrainFacesResponse.parse(response.data);
        dispatch({ type: FacesActions.TRAIN_FACES_FULFILLED, payload: response.data });
      })
      .catch(err => {
        console.error(err);
        dispatch({ type: FacesActions.TRAIN_FACES_REJECTED, payload: err });
      });
  };
}

// reusing training faces reducers since they are of similar nature
export function rescanFaces() {
  return function (dispatch) {
    dispatch({ type: FacesActions.TRAIN_FACES });
    dispatch({ type: FacesActions.SET_WORKER_AVAILABILITY, payload: false });
    dispatch({
      type: FacesActions.SET_WORKER_RUNNING_JOB,
      payload: { job_type_str: "Scan Faces" },
    });

    showNotification({
      message: i18n.t<string>("toasts.rescanfaces"),
      title: i18n.t<string>("toasts.rescanfacestitle"),
      color: "teal",
    });

    Server.get("scanfaces/", { timeout: 30000 })
      .then(response => {
        const data = ScanFacesResponse.parse(response.data);
        dispatch({ type: FacesActions.TRAIN_FACES_FULFILLED, payload: response.data });
      })
      .catch(err => {
        console.error(err);
        dispatch({ type: FacesActions.TRAIN_FACES_REJECTED, payload: err });
      });
  };
}

export function clusterFaces(dispatch) {
  dispatch({ type: FacesActions.CLUSTER_FACES });
  Server.get("clusterfaces/")
    .then(response => {
      const data = ClusterFaces.parse(response.data);
      dispatch({ type: FacesActions.CLUSTER_FACES_FULFILLED, payload: response.data });
    })
    .catch(err => {
      console.error(err);
      dispatch({ type: FacesActions.CLUSTER_FACES_REJECTED, payload: err });
    });
}

export function fetchInferredFacesList() {
  return function (dispatch) {
    dispatch({ type: FacesActions.FETCH_INFERRED_FACES_LIST });
    Server.get("faces/inferred/list/")
      .then(response => {
        const data = FaceList.parse(response.data.results);
        dispatch({
          type: FacesActions.FETCH_INFERRED_FACES_LIST_FULFILLED,
          payload: response.data.results,
        });
      })
      .catch(err => {
        console.error(err);
        dispatch({ type: FacesActions.FETCH_INFERRED_FACES_LIST_REJECTED, payload: err });
      });
  };
}

export function fetchLabeledFacesList() {
  return function (dispatch) {
    dispatch({ type: FacesActions.FETCH_LABELED_FACES_LIST });
    Server.get("faces/labeled/list/")
      .then(response => {
        const data = FaceList.parse(response.data.results);
        dispatch({
          type: FacesActions.FETCH_LABELED_FACES_LIST_FULFILLED,
          payload: response.data.results,
        });
      })
      .catch(err => {
        console.error(err);
        dispatch({ type: FacesActions.FETCH_LABELED_FACES_LIST_REJECTED, payload: err });
      });
  };
}
