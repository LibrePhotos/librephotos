import { createSlice, current } from "@reduxjs/toolkit";

import { api } from "../../api_client/api";
import type { ICompletePersonFace, ICompletePersonFaceList, IFacesState } from "./facesActions.types";

const initialState: IFacesState = {
  labeledFacesList: [] as ICompletePersonFaceList[],
  inferredFacesList: [] as ICompletePersonFaceList[],
  facesVis: [],
  training: false,
  trained: false,
  clustering: false,
  clustered: false,
  error: null,
};

const faceSlice = createSlice({
  name: "face",
  initialState: initialState,
  reducers: {},
  extraReducers: builder => {
    builder
      //@ts-ignore
      .addMatcher(api.endpoints.fetchIncompleteFaces.matchFulfilled, (state, { meta, payload }) => {
        const newFacesList: ICompletePersonFaceList = payload.map(person => {
          const completePersonFace: ICompletePersonFace = { ...person, faces: [] };
          for (let i = 0; i < person.face_count; i++) {
            completePersonFace.faces.push({
              id: i,
              image: null,
              face_url: null,
              photo: "",
              person_label_probability: 1,
              person: person.id,
              isTemp: true,
            });
          }
          return completePersonFace;
        });
        return {
          ...state,
          labeledFacesList: !meta.arg.originalArgs.inferred ? newFacesList : state.labeledFacesList,
          inferredFacesList: meta.arg.originalArgs.inferred ? newFacesList : state.inferredFacesList,
        };
      })
      .addMatcher(api.endpoints.fetchFaces.matchFulfilled, (state, { meta, payload }) => {
        const inferred = meta.arg.originalArgs.inferred;
        var personListToChange = inferred ? state.inferredFacesList : state.labeledFacesList;
        const personId = meta.arg.originalArgs.person;
        //@ts-ignore
        const indexToReplace = personListToChange.findIndex(person => person.id === personId);
        const personToChange = personListToChange[indexToReplace];
        //@ts-ignore
        const currentFaces = personToChange.faces;
        //@ts-ignore
        const newFaces = payload.results;

        const updatedFaces = currentFaces
          .slice(0, (meta.arg.originalArgs.page - 1) * 100)
          .concat(newFaces)
          .concat(currentFaces.slice(meta.arg.originalArgs.page * 100));

        //@ts-ignore
        personToChange.faces = updatedFaces;
        personListToChange[indexToReplace] = personToChange;
      })
      .addDefaultCase(state => state);
  },
});

export const { reducer: faceReducer, actions: faceActions } = faceSlice;
