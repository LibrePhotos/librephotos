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

function startDownloadProcess(options: DownloadOptions) {
  return fetchClient.post<DownloadResponse>("/photos/download", options);
}

function checkDownloadStatus(job_id: string) {
  return fetchClient.get<StatusResponse>(`/photos/download?job_id=${job_id}`);
}

// How often the archive job is polled.
export const DOWNLOAD_POLL_INTERVAL_MS = 3000;

async function downloadFile(fileUuid: string) {
  // Served by the backend (UnifiedMediaAccessView), which appends the
  // requester's user id and ".zip" itself. It works behind the proxy (X-Accel)
  // and without it; the old nginx-only /api/downloads/ route 404ed on the
  // unified image, the Windows build and native dev.
  const response = await fetch(`${serverAddress}/media/zip/${fileUuid}`, {
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

      // One check at a time, the next scheduled only after the previous one
      // settled. With setInterval a thrown check (network error, 404) left the
      // timer running forever and toasted on every tick.
      const poll = async () => {
        const response = await checkDownloadStatus(jobId).catch(err => {
          console.error("[Download] Status check failed", err);
          return null;
        });
        if (!response) {
          notification.downloadFailed();
          return;
        }
        const { status } = response;
        console.log("[Download] Status check", { jobId, status });
        switch (status) {
          case "SUCCESS": {
            console.log("[Download] Job succeeded, downloading file", { filename });
            try {
              await downloadFile(filename);
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
            console.error("[Download] Job failed", { jobId });
            notification.downloadFailed();
            break;

          default:
            // Still building the archive
            setTimeout(poll, DOWNLOAD_POLL_INTERVAL_MS);
            break;
        }
      };
      setTimeout(poll, DOWNLOAD_POLL_INTERVAL_MS);

      return { success: true };
    },
  });
