import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { fetchClient } from "../../api";
import { serverAddress } from "../../apiClient";
import type { BulkPhotoQuery } from "../../photos/types";
import { POLL_ARCHIVE_MS, pollUntil } from "@librephotos/api-client";

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

// Downloads still waiting on their archive job or on the file; cancelPhotoDownloads() aborts them.
const activeDownloads = new Set<AbortController>();

/** Stops following every photo download that is still running. The archive job itself is not cancelled. */
export function cancelPhotoDownloads() {
  for (const controller of activeDownloads) {
    controller.abort();
  }
}

async function downloadFile(fileUuid: string, signal: AbortSignal) {
  // Served by the backend (UnifiedMediaAccessView), which appends the
  // requester's user id and ".zip" itself. It works behind the proxy (X-Accel)
  // and without it; the old nginx-only /api/downloads/ route 404ed on the
  // unified image, the Windows build and native dev.
  const response = await fetch(`${serverAddress}/media/zip/${fileUuid}`, {
    credentials: "include",
    signal,
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

// Download photos. The mutation is pending until the archive is saved, so isPending covers the
// whole download. A cancelled download rejects without a failure toast.
export const useDownloadPhotosMutation = () =>
  useMutation({
    mutationFn: async (args: DownloadMutationArgs) => {
      const { userId, includeStackedPhotos = false } = args;
      notification.downloadStarting();

      if (!userId) {
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

      const controller = new AbortController();
      activeDownloads.add(controller);
      try {
        const { job_id: jobId, url: filename } = await startDownloadProcess(downloadRequest);

        const archive = await pollUntil(() => checkDownloadStatus(jobId), {
          isDone: ({ status }) => status === "SUCCESS" || status === "FAILURE",
          intervalMs: POLL_ARCHIVE_MS,
          signal: controller.signal,
        });
        if (archive.status === "FAILURE") {
          throw new Error(`Archive job ${jobId} failed`);
        }

        await downloadFile(filename, controller.signal);
        await fetchClient.delete(`/delete/zip/${filename}`);
        notification.downloadCompleted();
        return { success: true };
      } catch (err) {
        if (!controller.signal.aborted) {
          notification.downloadFailed();
        }
        throw err;
      } finally {
        activeDownloads.delete(controller);
      }
    },
  });
