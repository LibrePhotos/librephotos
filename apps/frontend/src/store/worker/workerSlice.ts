import { createSlice } from "@reduxjs/toolkit";

import { api } from "../../api_client/api";
import { IWorkerAvailabilityResponse, WorkerAvailabilityResponse } from "./worker.zod";

const initialState: IWorkerAvailabilityResponse = {
  status: true,
  job_detail: undefined,
  queue_can_accept_job: false,
};

const workerSlicte = createSlice({
  name: "worker",
  initialState: initialState,
  reducers: {},
  extraReducers: builder => {
    builder.addMatcher(api.endpoints.worker.matchFulfilled, (state, { payload }) => {
      try {
        const parsed = WorkerAvailabilityResponse.parse(payload);
        return { ...state, ...parsed };
      } catch (e) {
        console.error(e);
        return state;
      }
    });
  },
});

export const worker = workerSlicte.reducer;
