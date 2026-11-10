import type { UploadCompleteResponse } from "@librephotos/api-client";
import { useRef, useState, useSyncExternalStore } from "react";
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
import {
  EMPTY_QUEUE,
  nextPending,
  reduceQueue,
  type AlbumOutcome,
  type Finished,
  type QueueEvent,
  type QueueRun,
  type QueueState,
  type UploadAlbumTarget,
  type UploadItem,
} from "./uploadQueueState";

export type UploadQueue = {
  items: UploadItem[];
  run: QueueRun;
  /** The worker is running (`run` is not idle). */
  isUploading: boolean;
  /** Append files to the queue, filed into `album` when given, and start uploading if idle. */
  start: (files: File[], album?: UploadAlbumTarget) => void;
  /** Re-queue these items; one not failed or cancelled by now (a second click) is ignored. */
  retry: (ids: readonly string[]) => void;
  /**
   * Stop the running upload: waiting files and the file in flight end as "cancelled",
   * finished files stay. Files added afterwards upload normally.
   */
  cancel: () => void;
  /** Clear the list. Ignored while an upload is running. */
  reset: () => void;
};

/** What one file's run ends in: whether a new file landed, the album it was filed into, its import job. */
type Processed = { uploaded: boolean; filedInto?: number; jobId?: string; existing?: ExistingInAlbum };

/** How the server took a completed upload: its import job and photo, or a file it already had. */
type Completed = { albumOutcome?: AlbumOutcome; answer: UploadCompleteResponse };

/** The row of a completed upload; the server answers a file it already had with `detail` and no job. */
const finishedRow = ({ albumOutcome, answer }: Completed): Finished => {
  const photoId = answer.photo_id ?? undefined;
  if (!answer.job_id && answer.detail) return { status: "duplicate", albumOutcome, photoId };
  return { status: "done", albumOutcome, jobId: answer.job_id ?? undefined, photoId };
};

/** What one run of the worker collects for the end of the run. */
type Run = { uploadedAny: boolean; filled: Set<number>; jobIds: Set<string>; existing: ExistingInAlbum[] };

type User = { id: number };

type QueueStore = {
  get: () => QueueState;
  dispatch: (event: QueueEvent) => void;
  subscribe: (listener: () => void) => () => void;
};

/**
 * The queue's state in one place that the worker reads synchronously and React renders from, so
 * the worker's "am I running" and the card's never disagree, not even for a render.
 */
function createQueueStore(): QueueStore {
  let state = EMPTY_QUEUE;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    dispatch: event => {
      const next = reduceQueue(state, event);
      if (next === state) return;
      state = next;
      listeners.forEach(listener => listener());
    },
    subscribe: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

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

/** A file the library already has, to file into its album once the queue drains. */
const existingIn = (item: UploadItem, photoId: string | null | undefined): ExistingInAlbum | undefined =>
  item.album && photoId ? { itemId: item.id, albumId: item.album.id, photoId } : undefined;

const note = (current: Run, { uploaded, filedInto, jobId, existing }: Processed) => {
  current.uploadedAny = uploaded || current.uploadedAny;
  if (filedInto !== undefined) current.filled.add(filedInto);
  if (jobId) current.jobIds.add(jobId);
  if (existing) current.existing.push(existing);
};

/**
 * Upload state that outlives the button which started it: files are pushed
 * through one sequential worker (the server is easily overwhelmed by parallel
 * chunk streams) and each file keeps its own status for the progress card.
 * When the worker drains, the run's import jobs are sealed (#2737); the photo
 * queries are refreshed as the server makes the photos ready
 * (`useUploadProcessing`), or at once by a server that names no import job.
 * Every change goes through `reduceQueue` (`uploadQueueState.ts`).
 */
export function useUploadQueue(): UploadQueue {
  const { data: userSelfDetails } = useCurrentUserSelfDetailsQuery();
  const uploadMutation = useUploadMutation();
  // The card reports a failed file, and an album refusal is retried without the album.
  const uploadFinishedMutation = useUploadFinishedMutation({ reportsErrors: true });
  const refreshAlbums = useRefreshUploadAlbums();
  const [store] = useState(createQueueStore);
  const { items, run } = useSyncExternalStore(store.subscribe, store.get);
  const { dispatch } = store;

  const userRef = useRef(userSelfDetails);
  userRef.current = userSelfDetails;

  /** The file in flight is cancelled from cancel() until it ends. */
  const isCancelled = () => store.get().run === "cancelling";

  /** Sends the file in chunks and completes it; resolves to how filing into its album came out. */
  const uploadFile = async (item: UploadItem, user: User, md5: string): Promise<Completed> => {
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
      dispatch({ type: "progress", id: item.id, progress: file.size ? Math.round((sent / file.size) * 100) : 100 });
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

  const processOne = async (item: UploadItem): Promise<Processed> => {
    try {
      const user = userRef.current;
      if (!user) throw new Error(i18n.t("upload.not_signed_in"));

      // The server cannot store an empty file (there is no chunk to send), and
      // waiting on one used to stall every file queued after it.
      if (item.file.size === 0) throw new Error(i18n.t("upload.empty_file"));

      dispatch({ type: "hashing", id: item.id });
      const md5 = await calculateMD5(item.file, isCancelled);
      const known = await uploadExists(md5, user.id);
      if (known.exists) {
        dispatch({ type: "finished", id: item.id, result: { status: "duplicate" } });
        return { uploaded: false, existing: existingIn(item, known.photo_id) };
      }

      dispatch({ type: "uploading", id: item.id });
      const completed = await uploadFile(item, user, md5);
      const row = finishedRow(completed);
      dispatch({ type: "finished", id: item.id, result: row });
      if (row.status === "duplicate") return { uploaded: false };
      return { uploaded: true, filedInto: completed.albumOutcome ? undefined : item.album?.id, jobId: row.jobId };
    } catch (err) {
      // A request that fails after cancel() is part of the cancel, not an error.
      dispatch({
        type: "stopped",
        id: item.id,
        result: isCancelled() ? { status: "cancelled" } : { status: "error", error: errorMessage(err) },
      });
      return { uploaded: false };
    }
  };

  /** Adds the files the library already had to their albums; resolves to the albums filled. */
  const fileExisting = async (existing: ExistingInAlbum[]): Promise<number[]> => {
    const outcomes = await fileExistingIntoAlbums(existing);
    dispatch({ type: "filed", outcomes });
    return outcomes.filter(o => o.outcome === "added_existing").map(o => o.albumId);
  };

  const drain = async (): Promise<void> => {
    if (store.get().run !== "idle" || !nextPending(store.get())) return;
    dispatch({ type: "runStarted" });
    const current: Run = { uploadedAny: false, filled: new Set(), jobIds: new Set(), existing: [] };
    const next = async (): Promise<void> => {
      const queued = nextPending(store.get());
      if (!queued) return;
      note(current, await processOne(queued));
      dispatch({ type: "fileEnded" });
      await next();
    };
    try {
      await next();
      (await fileExisting(current.existing)).forEach(id => current.filled.add(id));
    } finally {
      dispatch({ type: "runEnded" });
      // The run's import jobs can finish now; the card follows them and refreshes the timeline as
      // photos become ready. A server that names no job gets the refresh now, as before #2739.
      void sealUploadImports([...current.jobIds]);
      if (current.uploadedAny && current.jobIds.size === 0) invalidateUploadQueries();
      refreshAlbums([...current.filled]);
      // Files added while the run filed known files into their albums found the worker running.
      void drain();
    }
  };

  const start = (files: File[], album?: UploadAlbumTarget) => {
    dispatch({
      type: "added",
      items: files.map(file => ({ id: newId(), file, status: "pending", progress: 0, album })),
    });
    void drain();
  };

  const retry = (ids: readonly string[]) => {
    dispatch({ type: "retried", ids });
    void drain();
  };

  const cancel = () => dispatch({ type: "cancel" });

  const reset = () => dispatch({ type: "reset" });

  return { items, run, isUploading: run !== "idle", start, retry, cancel, reset };
}
