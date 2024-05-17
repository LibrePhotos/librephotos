import { z } from "zod";

import { notification } from "../../service/notifications";
import { api } from "../api";

const JobResponseSchema = z.object({
  status: z.boolean(),
  job_id: z.string(),
});
type JobResponse = z.infer<typeof JobResponseSchema>;

enum Endpoints {
  scanPhotos = "scanPhotos",
  rescanPhotos = "rescanPhotos",
  scanNextcloudPhotos = "scanNextcloudPhotos",
}

export const scanPhotosApi = api.injectEndpoints({
  endpoints: builder => ({
    [Endpoints.scanPhotos]: builder.mutation<JobResponse, void>({
      query: () => ({
        url: "scanphotos/",
        method: "POST",
        body: {},
      }),
      async onQueryStarted(_args, { queryFulfilled, dispatch }) {
        dispatch({ type: "SCAN_PHOTOS" });
        dispatch({ type: "SET_WORKER_AVAILABILITY", payload: false });
        const response = await queryFulfilled;
        const jobResponse = JobResponseSchema.parse(response.data);
        notification.startPhotoScan();
        dispatch({ type: "SCAN_PHOTOS_FULFILLED", payload: jobResponse });
      },
    }),
    [Endpoints.rescanPhotos]: builder.mutation<JobResponse, void>({
      query: () => ({
        url: "fullscanphotos/",
        method: "POST",
        body: {},
      }),
      async onQueryStarted(_args, { queryFulfilled, dispatch }) {
        dispatch({ type: "SCAN_PHOTOS" });
        dispatch({ type: "SET_WORKER_AVAILABILITY", payload: false });
        const response = await queryFulfilled;
        const jobResponse = JobResponseSchema.parse(response.data);
        notification.startFullPhotoScan();
        dispatch({ type: "SCAN_PHOTOS_FULFILLED", payload: jobResponse });
      },
    }),
    [Endpoints.scanNextcloudPhotos]: builder.mutation<JobResponse, void>({
      query: () => ({
        url: "nextcloud/scanphotos/",
        method: "POST",
        body: {},
      }),
      async onQueryStarted(_args, { queryFulfilled, dispatch }) {
        dispatch({ type: "SCAN_PHOTOS" });
        dispatch({ type: "SET_WORKER_AVAILABILITY", payload: false });
        const response = await queryFulfilled;
        const jobResponse = JobResponseSchema.parse(response.data);
        notification.startNextcloudPhotoScan();
        dispatch({ type: "SCAN_PHOTOS_FULFILLED", payload: jobResponse });
      },
    }),
  }),
});

export const { useScanPhotosMutation, useRescanPhotosMutation, useScanNextcloudPhotosMutation } = scanPhotosApi;
