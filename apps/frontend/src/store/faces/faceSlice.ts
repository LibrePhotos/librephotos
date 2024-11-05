import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";

import { api } from "../../api_client/api";
import {
  CompletePersonFaceList,
  FaceAnalysisMethod,
  FacesOrderOption,
  FacesState,
  FacesTab,
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
  minConfidence: 0.5,
  tabs: {
    labeled: { scrollPosition: 0 },
    inferred: { scrollPosition: 0 },
    unknown: { scrollPosition: 0 },
  } as TabSettingsArray,
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
    changeFacesOrderBy: (state, action: PayloadAction<FacesOrderOption>) => {
      // eslint-disable-next-line no-param-reassign
      state.orderBy = action.payload;
    },
    changeAnalysisMethod: (state, action: PayloadAction<FaceAnalysisMethod>) => {
      state.analysisMethod = action.payload;
    },
    changeMinConfidence: (state, action: PayloadAction<number>) => {
      state.minConfidence = action.payload;
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
      .addDefaultCase(state => state);
  },
});

export const { reducer: faceReducer, actions: faceActions } = faceSlice;
