import type { PayloadAction } from "@reduxjs/toolkit";
import { createSlice } from "@reduxjs/toolkit";

import { api } from "../../api_client/api";

const initialState = {
  serverStats: null,
};

const utilSlice = createSlice({
  name: "util",
  initialState: initialState,
  reducers: {},
  extraReducers: builder => {
    builder
      .addMatcher(api.endpoints.fetchServerStats.matchFulfilled, (state, { payload }) => ({
        ...state,
        serverStats: payload,
      }))
      .addMatcher(api.endpoints.fetchServerStats.matchRejected, (state, { payload }) => ({
        ...state,
        error: payload,
      }))
      .addDefaultCase(state => state);
  },
});

export const { reducer: utilReducer, actions: utilActions } = utilSlice;
