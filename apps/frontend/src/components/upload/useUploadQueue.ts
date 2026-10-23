import type { UploadCompleteResponse } from "@librephotos/api-client";
import { useRef, useState } from "react";
import {
  invalidateUploadQueries,
  isUploadAlbumRefusal,
  sealUploadImports,
  uploadExists,
  useRefreshUploadAlbums,
  useUploadFinishedMutation,
  useUploadMutation,
} from "../../api_client/upload";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import i18n from "../../i18n";
import { fileExistingIntoAlbums, type ExistingInAlbum } from "./albumFiling";
import { calculateChunks, calculateMD5, UploadCancelledError } from "./chunkedUpload";

export type UploadStatus = "pending" | "hashing" | "uploading" | "done" | "duplicate" | "error" | "cancelled";

/** One of the user's own albums an upload files into (#612). */
export type UploadAlbumTarget = { id: number; title: string };

/**
 * How filing into the album came out, where it differs from "uploaded into it": a file the library
 * already had was added to it, or the album refused the file (locked or deleted meanwhile), which
 * went to the library only.
 */
export type AlbumOutcome = "added_existing" | "library_only";

export type UploadItem = {
  id: string;
  file: File;
  status: UploadStatus;
  /** 0..100, bytes of this file sent so far */
  progress: number;
  error?: string;
  /** The album the file goes into; none for the library alone. */
  album?: UploadAlbumTarget;
  albumOutcome?: AlbumOutcome;
  /** The import job processing the uploaded file, and the photo it made (#2737; newer servers). */
  jobId?: string;
  photoId?: string;
};

export type UploadQueue = {
  items: UploadItem[];
  isUploading: boolean;
  /** Between cancel() and the end of the file in flight (its current chunk or hash slice). */
  isCancelling: boolean;
  /** Append files to the queue, filed into `album` when given, and start uploading if idle. */
  start: (files: File[], album?: UploadAlbumTarget) => void;
  /** Re-queue the given items; anything not failed or cancelled is ignored. */
  retry: (targets: UploadItem[]) => void;
  /**
   * Stop the running upload: waiting files and the file in flight end as "cancelled",
   * finished files stay. Files added afterwards upload normally.
   */
  cancel: () => void;
  /** Clear the list. Ignored while an upload is running. */
  reset: () => void;
};

/** What one file's run ends in: whether a new file landed, the album it was filed into, its import job. */
type Processed = { uploaded: boolean; filedInto?: number; jobId?: string };

/** How the server took a completed upload: its import job and photo, or a file it already had. */
type Completed = { albumOutcome?: AlbumOutcome; answer: UploadCompleteResponse };

/** The row of a completed upload; the server answers a file it already had with `detail` and no job. */
const completedRow = ({ albumOutcome, answer }: Completed): Partial<UploadItem> => ({
  status: !answer.job_id && answer.detail ? "duplicate" : "done",
  progress: 100,
  albumOutcome,
  jobId: answer.job_id ?? undefined,
  photoId: answer.photo_id ?? undefined,
});

/** A queued item and the cancel generation it was queued in; cancel() bumps the generation. */
type QueuedUpload = { item: UploadItem; generation: number };

type User = { id: number };

const sequentially = <T>(list: T[], fn: (item: T) => Promise<void>): Promise<void> =>
  list.reduce((chain, item) => chain.then(() => fn(item)), Promise.resolve());

let nextId = 0;
const newId = () => {
  nextId += 1;
  return `upload-${Date.now()}-${nextId}`;
};

const errorMessage = (err: unknown): string => {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  return "";
};

/**
 * Upload state that outlives the button which started it: files are pushed
 * through one sequential worker (the server is easily overwhelmed by parallel
 * chunk streams) and each file keeps its own status for the progress card.
 * When the worker drains, the run's import jobs are sealed (#2737); the photo
 * queries are refreshed as the server makes the photos ready
 * (`useUploadProcessing`), or at once by a server that names no import job.
 */
export function useUploadQueue(): UploadQueue {
  const { data: userSelfDetails } = useCurrentUserSelfDetailsQuery();
  const uploadMutation = useUploadMutation();
  // The card reports a failed file, and an album refusal is retried without the album.
  const uploadFinishedMutation = useUploadFinishedMutation({ reportsErrors: true });
  const refreshAlbums = useRefreshUploadAlbums();
  const [items, setItems] = useState<UploadItem[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const userRef = useRef(userSelfDetails);
  userRef.current = userSelfDetails;
  const [isCancelling, setIsCancelling] = useState(false);
  const pendingRef = useRef<QueuedUpload[]>([]);
  const drainingRef = useRef(false);
  const generationRef = useRef(0);
  /** Files the library already had, to add to their album once the queue drains. */
  const existingRef = useRef<ExistingInAlbum[]>([]);

  const patchItem = (id: string, patch: Partial<UploadItem>) => {
    setItems(prev => prev.map(it => (it.id === id ? { ...it, ...patch } : it)));
  };

  /** Sends the file in chunks and completes it; resolves to how filing into its album came out. */
  const uploadFile = async (
    item: UploadItem,
    user: User,
    md5: string,
    isCancelled: () => boolean
  ): Promise<Completed> => {
    const throwIfCancelled = () => {
      if (isCancelled()) throw new UploadCancelledError();
    };
    const { file } = item;
    let offset = 0;
    let uploadId = "";
    let sent = 0;
    await sequentially(calculateChunks(file), async chunk => {
      throwIfCancelled();
      const formData = new FormData();
      if (uploadId) formData.append("upload_id", uploadId);
      formData.append("file", chunk);
      formData.append("md5", "");
      formData.append("offset", offset.toString());
      formData.append("user", user.id.toString());
      const response = await uploadMutation.mutateAsync({ form_data: formData, offset, chunk_size: chunk.size });
      offset = response.offset;
      uploadId = response.upload_id;
      sent += chunk.size;
      patchItem(item.id, { progress: file.size ? Math.round((sent / file.size) * 100) : 100 });
    });

    throwIfCancelled();
    return completeUpload(item, { upload_id: uploadId, md5, user: user.id.toString(), filename: file.name });
  };

  const complete = (fields: Record<string, string>, albumId?: number) => {
    const formData = new FormData();
    Object.entries(fields).forEach(([key, value]) => formData.append(key, value));
    if (albumId !== undefined) formData.append("album_id", albumId.toString());
    return uploadFinishedMutation.mutateAsync({ formData, shouldInvalidate: false });
  };

  /**
   * Completes the upload into its album. An album the server refuses (locked or deleted since)
   * leaves the staged file in place, so it is completed again into the library alone.
   */
  const completeUpload = async (item: UploadItem, fields: Record<string, string>): Promise<Completed> => {
    if (!item.album) return { answer: await complete(fields) };
    try {
      return { answer: await complete(fields, item.album.id) };
    } catch (err) {
      if (!isUploadAlbumRefusal(err)) throw err;
      return { answer: await complete(fields), albumOutcome: "library_only" };
    }
  };

  /** A file the library already has: filed into its album later, when the server told its id. */
  const noteExisting = (item: UploadItem, photoId: string | null | undefined) => {
    if (item.album && photoId) existingRef.current.push({ itemId: item.id, albumId: item.album.id, photoId });
  };

  const processOne = async ({ item, generation }: QueuedUpload): Promise<Processed> => {
    const isCancelled = () => generation !== generationRef.current;
    try {
      const user = userRef.current;
      if (!user) throw new Error(i18n.t("upload.not_signed_in"));

      // The server cannot store an empty file (there is no chunk to send), and
      // waiting on one used to stall every file queued after it.
      if (item.file.size === 0) throw new Error(i18n.t("upload.empty_file"));

      patchItem(item.id, { status: "hashing", progress: 0, error: undefined });
      const md5 = await calculateMD5(item.file, isCancelled);
      const known = await uploadExists(md5, user.id);
      if (known.exists) {
        patchItem(item.id, { status: "duplicate", progress: 100 });
        noteExisting(item, known.photo_id);
        return { uploaded: false };
      }

      patchItem(item.id, { status: "uploading", progress: 0 });
      const completed = await uploadFile(item, user, md5, isCancelled);
      const row = completedRow(completed);
      patchItem(item.id, row);
      const uploaded = row.status === "done";
      const filedInto = uploaded && !completed.albumOutcome ? item.album?.id : undefined;
      return { uploaded, filedInto, jobId: row.jobId };
    } catch (err) {
      // A request that fails after cancel() is part of the cancel, not an error.
      patchItem(
        item.id,
        isCancelled() ? { status: "cancelled", progress: 0 } : { status: "error", error: errorMessage(err) }
      );
      return { uploaded: false };
    }
  };

  /** Adds the files the library already had to their albums; resolves to the albums filled. */
  const fileExisting = async (): Promise<number[]> => {
    const outcomes = await fileExistingIntoAlbums(existingRef.current.splice(0));
    outcomes.forEach(({ itemId, outcome }) => patchItem(itemId, { albumOutcome: outcome }));
    return outcomes.filter(o => o.outcome === "added_existing").map(o => o.albumId);
  };

  const drain = async () => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    setIsUploading(true);
    let uploadedAny = false;
    const filled = new Set<number>();
    const jobIds = new Set<string>();
    const next = async (): Promise<void> => {
      const queued = pendingRef.current.shift();
      if (!queued) return;
      const { uploaded, filedInto, jobId } = await processOne(queued);
      uploadedAny = uploaded || uploadedAny;
      if (filedInto !== undefined) filled.add(filedInto);
      if (jobId) jobIds.add(jobId);
      setIsCancelling(false);
      await next();
    };
    try {
      await next();
      (await fileExisting()).forEach(id => filled.add(id));
    } finally {
      drainingRef.current = false;
      setIsUploading(false);
      setIsCancelling(false);
      // The run's import jobs can finish now; the card follows them and refreshes the timeline as
      // photos become ready. A server that names no job gets the refresh now, as before #2739.
      void sealUploadImports([...jobIds]);
      if (uploadedAny && jobIds.size === 0) invalidateUploadQueries();
      refreshAlbums([...filled]);
    }
  };

  const enqueue = (queued: UploadItem[]) => {
    if (queued.length === 0) return;
    const generation = generationRef.current;
    pendingRef.current.push(...queued.map(item => ({ item, generation })));
    void drain();
  };

  const start = (files: File[], album?: UploadAlbumTarget) => {
    const queued = files.map(file => ({ id: newId(), file, status: "pending" as const, progress: 0, album }));
    setItems(prev => [...prev, ...queued]);
    enqueue(queued);
  };

  const retry = (targets: UploadItem[]) => {
    const retryable = targets.filter(it => it.status === "error" || it.status === "cancelled");
    retryable.forEach(it => patchItem(it.id, { status: "pending", progress: 0, error: undefined }));
    enqueue(retryable.map(it => ({ ...it, status: "pending" as const, progress: 0, error: undefined })));
  };

  const cancel = () => {
    if (!drainingRef.current) return;
    generationRef.current += 1;
    const dropped = new Set(pendingRef.current.splice(0).map(queued => queued.item.id));
    setItems(prev => prev.map(it => (dropped.has(it.id) ? { ...it, status: "cancelled", progress: 0 } : it)));
    setIsCancelling(true);
  };

  const reset = () => {
    if (drainingRef.current) return;
    setItems([]);
  };

  return { items, isUploading, isCancelling, start, retry, cancel, reset };
}
