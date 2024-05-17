import { QueryReturnValue } from "@reduxjs/toolkit/dist/query/baseQueryTypes";
import { MaybePromise } from "@reduxjs/toolkit/dist/query/tsHelpers";
import { FetchBaseQueryError } from "@reduxjs/toolkit/query";
import { FetchArgs } from "@reduxjs/toolkit/query/react";

import { notification } from "../../service/notifications";
import { api } from "../api";

type BaseQueryResult<T> = QueryReturnValue<T, FetchBaseQueryError, {}>;
type BaseQuery<T> = (arg: string | FetchArgs) => MaybePromise<BaseQueryResult<T>>;
type StatusResponse = { status: string };

type DownloadResponse = {
  url: string;
  job_id: string;
};

async function startDownloadProcess(baseQuery: BaseQuery<DownloadResponse>, image_hashes: string[]) {
  return (await baseQuery({ url: "photos/download", method: "POST", body: { image_hashes } })).data!;
}

async function checkDownloadStatus(baseQuery: BaseQuery<StatusResponse>, job_id: string) {
  return (await baseQuery({ url: `photos/download?job_id=${job_id}` })).data!;
}

async function downloadFile(baseQuery: BaseQuery<Blob>, filename: string) {
  const response = await baseQuery({ url: `/downloads/${filename}`, responseHandler: r => r.blob() });
  const downloadUrl = window.URL.createObjectURL(new Blob([response.data!], { type: "application/zip" }));
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.setAttribute("download", "file.zip");
  document.body.appendChild(link);
  link.click();
  link.remove();
}

enum Endpoints {
  downloadPhotos = "downloadPhotos",
}

export const downloadApi = api.injectEndpoints({
  endpoints: build => ({
    [Endpoints.downloadPhotos]: build.query<void, { image_hashes: string[] }>({
      async onQueryStarted() {
        notification.downloadStarting();
      },
      queryFn: async ({ image_hashes }, baseQueryApi, _extraOptions, baseQuery) => {
        const userId = (baseQueryApi.getState() as any).user.userSelfDetails.id;
        const { job_id: jobId, url: filename } = await startDownloadProcess(
          baseQuery as BaseQuery<DownloadResponse>,
          image_hashes
        );

        const statusInterval = setInterval(async () => {
          const { status } = await checkDownloadStatus(baseQuery as BaseQuery<{ status: string }>, jobId);
          switch (status) {
            case "SUCCESS":
              clearInterval(statusInterval);
              await downloadFile(baseQuery as BaseQuery<Blob>, filename + userId);
              await baseQuery({ url: `/delete/zip/${filename}`, method: "DELETE" });
              notification.downloadCompleted();
              break;

            case "FAILURE":
              clearInterval(statusInterval);
              notification.downloadFailed();
              break;

            default:
              // noop on PROGRESS
              break;
          }
        }, 3000);

        return { data: undefined };
      },
    }),
  }),
});

export const { useLazyDownloadPhotosQuery } = downloadApi;
