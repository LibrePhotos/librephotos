import { useMutation } from '@tanstack/react-query';

import { notification } from "../../../service/notifications";
import { fetchClient } from "../../api";

type StatusResponse = { status: string };

type DownloadResponse = {
  url: string;
  job_id: string;
};

async function startDownloadProcess(image_hashes: string[]) {
  const response = await fetchClient.post('photos/download', { image_hashes });
  return response as DownloadResponse;
}

async function checkDownloadStatus(job_id: string) {
  const response = await fetchClient.get(`photos/download?job_id=${job_id}`);
  return response as StatusResponse;
}

async function downloadFile(filename: string) {
  const response = await fetchClient.get(`/downloads/${filename}`, { responseHandler: r => r.blob() });
  const downloadUrl = window.URL.createObjectURL(new Blob([response], { type: "application/zip" }));
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.setAttribute("download", "file.zip");
  document.body.appendChild(link);
  link.click();
  link.remove();
}

// Download photos
export const useDownloadPhotosMutation = () => useMutation({
  mutationFn: async ({ image_hashes }: { image_hashes: string[] }) => {
    notification.downloadStarting();
    
    const userId = (window as any).user?.userSelfDetails?.id || '';
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