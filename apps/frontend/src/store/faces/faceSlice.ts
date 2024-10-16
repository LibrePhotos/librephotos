import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";
import { unknown } from "zod";

import { api } from "../../api_client/api";
import { notification } from "../../service/notifications";
import {
  CompletePersonFace,
  CompletePersonFaceList,
  FaceAnalysisMethod,
  FacesOrderOption,
  FacesState,
  FacesTab,
  PersonFace,
  TabSettingsArray,
} from "./facesActions.types";

const initialState: FacesState = {
  labeledFacesList: [] as CompletePersonFaceList,
  unknownFacesList: [] as CompletePersonFaceList,
  inferredFacesList: [] as CompletePersonFaceList,
  facesVis: [],
  training: false,
  trained: false,
  clustering: false,
  clustered: false,
  orderBy: FacesOrderOption.enum.confidence,
  analysisMethod: FaceAnalysisMethod.enum.clustering,
  error: null,
  activeTab: FacesTab.enum.inferred,
  tabs: {
    labeled: { scrollPosition: 0 },
    inferred: { scrollPosition: 0 },
    unknown: { scrollPosition: 0 },
  } as TabSettingsArray,
};

const compareFacesConfidence = (a: PersonFace, b: PersonFace) => {
  if (a.person_label_probability > b.person_label_probability) return -1;
  if (a.person_label_probability < b.person_label_probability) return 1;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
};

const compareFacesDate = (a: PersonFace, b: PersonFace) => {
  const dateA = new Date(a.timestamp || "");
  const dateB = new Date(b.timestamp || "");
  if (dateA.toString() === "Invalid Date" && dateB.toString() === "Invalid Date") return compareFacesConfidence(a, b);
  if (dateA.toString() === "Invalid Date") return 1;
  if (dateB.toString() === "Invalid Date") return -1;
  if (dateA < dateB) return -1;
  if (dateA > dateB) return 1;
  return compareFacesConfidence(a, b);
};

const faceSlice = createSlice({
  name: "face",
  initialState,
  reducers: {
    changeTab: (state, action: PayloadAction<FacesTab>) => ({ ...state, activeTab: action.payload }),
    saveCurrentGridPosition: (state, action: PayloadAction<{ tab: FacesTab; position: number }>) => {
      const { tab, position } = action.payload;
      if (tab in state.tabs) {
        // @ts-ignore
        // eslint-disable-next-line no-param-reassign
        state.tabs[tab].scrollPosition = position;
      }
    },
    changeFacesOrderBy: (state, action: PayloadAction<IFacesOrderOption>) => {
      // eslint-disable-next-line no-param-reassign
      state.orderBy = action.payload;
    },
    changeAnalysisMethod: (state, action: PayloadAction<FaceAnalysisMethod>) => {
      state.analysisMethod = action.payload;
    },
  },
  extraReducers: builder => {
    builder
      .addMatcher(api.endpoints.clusterFaces.matchFulfilled, (state, { payload }) => ({
        ...state,
        // @ts-ignore
        facesVis: payload,
        clustered: true,
      }))
      .addMatcher(api.endpoints.trainFaces.matchFulfilled, (state, { payload }) => ({
        ...state,
        training: false,
        trained: true,
        // @ts-ignore
        facesVis: payload,
      }))
      .addMatcher(api.endpoints.deleteFaces.matchFulfilled, (state, { payload }) => {
        const facesToRemove = payload.results;
        const newLabeledFacesList = state.labeledFacesList;
        const newInferredFacesList = state.inferredFacesList;
        facesToRemove.forEach(face => {
          // find the person by finding the face and remove the face from it and update the list
          const personToChange = newLabeledFacesList.find(
            person => person.faces.filter(i => i.face_url === face).length > 0
          );
          if (personToChange) {
            const indexToRemove = personToChange.faces.findIndex(f => f.face_url === face);
            personToChange.faces.splice(indexToRemove, 1);
            const indexToReplace = newLabeledFacesList.findIndex(person => person.id === personToChange.id);
            if (personToChange.faces.length === 0) {
              newLabeledFacesList.splice(indexToReplace, 1);
            } else {
              newLabeledFacesList[indexToReplace] = personToChange;
            }
            personToChange.face_count = personToChange.faces.length;
          }
          // same thing for inferred
          const personToChangeInferred = newInferredFacesList.find(
            person => person.faces.filter(i => i.face_url === face).length > 0
          );
          if (personToChangeInferred) {
            const indexToRemoveInferred = personToChangeInferred.faces.findIndex(f => f.face_url === face);
            personToChangeInferred.faces.splice(indexToRemoveInferred, 1);
            const indexToReplaceInferred = newInferredFacesList.findIndex(
              person => person.id === personToChangeInferred.id
            );
            if (personToChangeInferred.faces.length === 0) {
              newInferredFacesList.splice(indexToReplaceInferred, 1);
            } else {
              newInferredFacesList[indexToReplaceInferred] = personToChangeInferred;
            }
            personToChangeInferred.face_count = personToChangeInferred.faces.length;
          }
        });
      })
      .addMatcher(api.endpoints.setFacesPersonLabel.matchFulfilled, (state, { payload }) => {
        notification.addFacesToPerson(payload.results[0].person_name, payload.results.length);
        const facesToRemove = payload.results;
        const facesToAdd = payload.results;
        const newLabeledFacesList = state.labeledFacesList;
        const newInferredFacesList = state.inferredFacesList;
        facesToRemove.forEach(face => {
          // find the person by finding the face and remove the face from it and update the list
          const personToChange = newLabeledFacesList.find(
            person => person.faces.filter(i => i.face_url === face.face_url).length > 0
          );
          if (personToChange) {
            const indexToRemove = personToChange.faces.findIndex(f => f.id === face.id);
            personToChange.faces.splice(indexToRemove, 1);
            const indexToReplace = newLabeledFacesList.findIndex(person => person.id === personToChange.id);
            if (personToChange.faces.length === 0) {
              newLabeledFacesList.splice(indexToReplace, 1);
            } else {
              newLabeledFacesList[indexToReplace] = personToChange;
            }
            personToChange.face_count = personToChange.faces.length;
          }
          // same thing for inferred
          const personToChangeInferred = newInferredFacesList.find(
            person => person.faces.filter(i => i.face_url === face.face_url).length > 0
          );
          if (personToChangeInferred) {
            const indexToRemoveInferred = personToChangeInferred.faces.findIndex(f => f.id === face.id);
            personToChangeInferred.faces.splice(indexToRemoveInferred, 1);
            const indexToReplaceInferred = newInferredFacesList.findIndex(
              person => person.id === personToChangeInferred.id
            );
            if (personToChangeInferred.faces.length === 0) {
              newInferredFacesList.splice(indexToReplaceInferred, 1);
            } else {
              newInferredFacesList[indexToReplaceInferred] = personToChangeInferred;
            }
            personToChangeInferred.face_count = personToChangeInferred.faces.length;
          }
        });

        facesToAdd.forEach(face => {
          // find the person and add the face to it and update the list
          const personToChange = newLabeledFacesList.find(person => person.id === face.person);
          if (personToChange) {
            personToChange.faces.push(face);
            personToChange.face_count = personToChange.faces.length;
            const indexToReplace = newLabeledFacesList.findIndex(person => person.id === face.person);
            newLabeledFacesList[indexToReplace] = personToChange;
          } else if (face.person && face.person_name) {
            // add new person and new face
            const newPerson: CompletePersonFace = {
              id: face.person,
              name: face.person_name,
              faces: [
                {
                  id: face.id,
                  face_url: face.face_url,
                  image: face.image,
                  person_label_probability: 1,
                  photo: face.photo,
                },
              ],
              kind: "USER",
              face_count: 1,
            };
            newLabeledFacesList.push(newPerson);
          }
        });

        // sort both lists by name
        newLabeledFacesList.sort((a, b) => {
          if (a.name.toLowerCase() < b.name.toLowerCase()) {
            return -1;
          }
          if (a.name.toLowerCase() > b.name.toLowerCase()) {
            return 1;
          }
          return 0;
        });
        newInferredFacesList.sort((a, b) => {
          if (a.name.toLowerCase() < b.name.toLowerCase()) {
            return -1;
          }
          if (a.name.toLowerCase() > b.name.toLowerCase()) {
            return 1;
          }
          return 0;
        });
      })
      .addDefaultCase(state => state);
  },
});

export const { reducer: faceReducer, actions: faceActions } = faceSlice;
