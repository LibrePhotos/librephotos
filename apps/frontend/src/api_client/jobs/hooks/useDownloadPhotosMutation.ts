import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { fetchClient } from "../../api";

type StatusResponse = { status: string };

type DownloadResponse = {
  url: string;
  job_id: string;
};

async function startDownloadProcess(image_hashes: string[]) {
  const response = await fetchClient.post("/photos/download", { image_hashes });
  return response as DownloadResponse;
}

async function checkDownloadStatus(job_id: string) {
  const response = await fetchClient.get(`/photos/download?job_id=${job_id}`);
  return response as StatusResponse;
}

async function downloadFile(filename: string) {
  const response = await fetchClient.get(`/downloads/${filename}`);
  const blob = await response.blob();
  const downloadUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.setAttribute("download", "file.zip");
  document.body.appendChild(link);
  link.click();
  link.remove();
}

// Download photos
export const useDownloadPhotosMutation = () =>
  useMutation({
    mutationFn: async ({ image_hashes, userId }: { image_hashes: string[]; userId: number | null }) => {
      notification.downloadStarting();

      if (!userId) {
        notification.downloadFailed();
        throw new Error("User ID is required for download");
      }

      const { job_id: jobId, url: filename } = await startDownloadProcess(image_hashes);

      const statusInterval = setInterval(async () => {
        const { status } = await checkDownloadStatus(jobId);
        switch (status) {
          case "SUCCESS":
            clearInterval(statusInterval);
            await downloadFile(filename + userId);
            await fetchClient.delete(`/delete/zip/${filename}`);
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

      return { success: true };
    },
  });
