import type { AlbumOutcome, UploadAlbumTarget, UploadItem, UploadStatus } from "./uploadQueueState";

type Extra = {
  file?: File;
  album?: UploadAlbumTarget;
  progress?: number;
  error?: string;
  albumOutcome?: AlbumOutcome;
  jobId?: string;
  photoId?: string;
};

/** A queue item in `status`, with the fields of that status that `extra` names. */
export function uploadItem(id: string, status: UploadStatus, extra: Extra = {}): UploadItem {
  const base = { id, file: extra.file ?? new File([], id), album: extra.album, progress: extra.progress ?? 0 };
  switch (status) {
    case "error":
      return { ...base, status, error: extra.error ?? "" };
    case "done":
      return { ...base, status, albumOutcome: extra.albumOutcome, jobId: extra.jobId, photoId: extra.photoId };
    case "duplicate":
      return { ...base, status, albumOutcome: extra.albumOutcome, photoId: extra.photoId };
    case "pending":
    case "hashing":
    case "uploading":
    case "cancelled":
      return { ...base, status };
  }
}

/** The import job of a done item, the photo of a done or duplicate one, the error of a failed one. */
export const jobOf = (item: UploadItem | undefined) => (item?.status === "done" ? item.jobId : undefined);
export const photoOf = (item: UploadItem | undefined) =>
  item?.status === "done" || item?.status === "duplicate" ? item.photoId : undefined;
export const errorOf = (item: UploadItem | undefined) => (item?.status === "error" ? item.error : undefined);
