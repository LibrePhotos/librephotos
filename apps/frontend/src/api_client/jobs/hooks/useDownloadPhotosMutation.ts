import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { fetchClient } from "../../api";
import { serverAddress } from "../../apiClient";
import type { BulkPhotoQuery } from "../../photos/types";

type StatusResponse = { status: string };

type DownloadResponse = {
  url: string;
  job_id: string;
};

type IndividualDownloadOptions = {
  select_all?: false;
  image_hashes: string[];
  include_stacked_photos?: boolean;
};

type SelectAllDownloadOptions = {
  select_all: true;
  query: BulkPhotoQuery;
  excluded_hashes?: string[];
  include_stacked_photos?: boolean;
};

type DownloadOptions = IndividualDownloadOptions | SelectAllDownloadOptions;

async function startDownloadProcess(options: DownloadOptions) {
  const response = await fetchClient.post("/photos/download", options);
  return response as DownloadResponse;
}

async function checkDownloadStatus(job_id: string) {
  const response = await fetchClient.get(`/photos/download?job_id=${job_id}`);
  return response as StatusResponse;
}

async function downloadFile(filename: string) {
  // nginx route /api/downloads/{filename} maps to /protected_media/zip/{filename}.zip
  const response = await fetch(`${serverAddress}/api/downloads/${filename}`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
  }
  const blob = await response.blob();
  const downloadUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.setAttribute("download", "photos.zip");
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(downloadUrl);
}

type IndividualMutationArgs = {
  select_all?: false;
  image_hashes: string[];
  userId: number | null;
  includeStackedPhotos?: boolean;
};

type SelectAllMutationArgs = {
  select_all: true;
  query: BulkPhotoQuery;
  excluded_hashes?: string[];
  userId: number | null;
  includeStackedPhotos?: boolean;
};

type DownloadMutationArgs = IndividualMutationArgs | SelectAllMutationArgs;

// Download photos
export const useDownloadPhotosMutation = () =>
  useMutation({
    mutationFn: async (args: DownloadMutationArgs) => {
      const { userId, includeStackedPhotos = false } = args;
      console.log("[Download] Starting download process", { args });
      notification.downloadStarting();

      if (!userId) {
        console.error("[Download] Failed: User ID is missing");
        notification.downloadFailed();
        throw new Error("User ID is required for download");
      }

      const downloadRequest: DownloadOptions = args.select_all
        ? {
            select_all: true,
            query: args.query,
            excluded_hashes: args.excluded_hashes,
            include_stacked_photos: includeStackedPhotos,
          }
        : {
            image_hashes: args.image_hashes,
            include_stacked_photos: includeStackedPhotos,
          };
      const { job_id: jobId, url: filename } = await startDownloadProcess(downloadRequest);
      console.log("[Download] Job started", { jobId, filename });

      const statusInterval = setInterval(async () => {
        const { status } = await checkDownloadStatus(jobId);
        console.log("[Download] Status check", { jobId, status });
        switch (status) {
          case "SUCCESS": {
            clearInterval(statusInterval);
            const fullFilename = `${filename}${userId}`;
            console.log("[Download] Job succeeded, downloading file", { fullFilename });
            try {
              await downloadFile(fullFilename);
              console.log("[Download] File downloaded, deleting zip", { filename });
              await fetchClient.delete(`/delete/zip/${filename}`);
              notification.downloadCompleted();
              console.log("[Download] Complete");
            } catch (err) {
              console.error("[Download] Error during file download or cleanup", err);
              notification.downloadFailed();
            }
            break;
          }

          case "FAILURE":
            clearInterval(statusInterval);
            console.error("[Download] Job failed", { jobId });
            notification.downloadFailed();
            break;

          default:
            // noop on PROGRESS
            break;
        }
      }, 3000);

      return { success: true };
    },
  });
