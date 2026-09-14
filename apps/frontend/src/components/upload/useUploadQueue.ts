import { useRef, useState } from "react";
import { fetchClient } from "../../api_client/api";
import {
  invalidateUploadQueries,
  UploadExistResponse,
  useUploadFinishedMutation,
  useUploadMutation,
} from "../../api_client/upload";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { parseWithNotification } from "../../util/zodUtils";
import { calculateChunks, calculateMD5 } from "./chunkedUpload";

export type UploadStatus = "pending" | "hashing" | "uploading" | "done" | "duplicate" | "error";

export interface UploadItem {
  id: string;
  file: File;
  status: UploadStatus;
  /** 0..100, bytes of this file sent so far */
  progress: number;
  error?: string;
}

export interface UploadQueue {
  items: UploadItem[];
  isUploading: boolean;
  /** Append files to the queue and start uploading if idle. */
  start: (files: File[]) => void;
  /** Re-queue the given items; anything not in the error state is ignored. */
  retry: (targets: UploadItem[]) => void;
  /** Clear the list. Ignored while an upload is running. */
  reset: () => void;
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

/**
 * Upload state that outlives the button which started it: files are pushed
 * through one sequential worker (the server is easily overwhelmed by parallel
 * chunk streams), each file keeps its own status for the progress card, and
 * the photo queries are invalidated once when the worker drains.
 */
export function useUploadQueue(): UploadQueue {
  const { data: userSelfDetails } = useCurrentUserSelfDetailsQuery();
  const uploadMutation = useUploadMutation();
  const uploadFinishedMutation = useUploadFinishedMutation();
  const [items, setItems] = useState<UploadItem[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const userRef = useRef(userSelfDetails);
  userRef.current = userSelfDetails;
  const pendingRef = useRef<UploadItem[]>([]);
  const drainingRef = useRef(false);

  const patchItem = (id: string, patch: Partial<UploadItem>) => {
    setItems(prev => prev.map(it => (it.id === id ? { ...it, ...patch } : it)));
  };

  const uploadFile = async (item: UploadItem, md5: string): Promise<void> => {
    const user = userRef.current;
    if (!user) throw new Error("Not signed in");
    const { file } = item;
    let offset = 0;
    let uploadId = "";
    let sent = 0;
    await sequentially(calculateChunks(file), async chunk => {
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

    const formData = new FormData();
    formData.append("upload_id", uploadId);
    formData.append("md5", md5);
    formData.append("user", user.id.toString());
    formData.append("filename", file.name);
    await uploadFinishedMutation.mutateAsync({ formData, shouldInvalidate: false });
  };

  /** Resolves to true when a new file landed on the server. */
  const processOne = async (item: UploadItem): Promise<boolean> => {
    try {
      const user = userRef.current;
      if (!user) throw new Error("Not signed in");

      patchItem(item.id, { status: "hashing", progress: 0, error: undefined });
      const md5 = await calculateMD5(item.file);
      const response = await fetchClient.get<string>(`/exists/${md5 + user.id}`);
      const { exists } = parseWithNotification(UploadExistResponse, response, "Failed to parse upload exists response");
      if (exists) {
        patchItem(item.id, { status: "duplicate", progress: 100 });
        return false;
      }

      patchItem(item.id, { status: "uploading", progress: 0 });
      await uploadFile(item, md5);
      patchItem(item.id, { status: "done", progress: 100 });
      return true;
    } catch (err) {
      patchItem(item.id, { status: "error", error: errorMessage(err) });
      return false;
    }
  };

  const drain = async () => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    setIsUploading(true);
    let uploadedAny = false;
    const next = async (): Promise<void> => {
      const item = pendingRef.current.shift();
      if (!item) return;
      uploadedAny = (await processOne(item)) || uploadedAny;
      await next();
    };
    try {
      await next();
    } finally {
      drainingRef.current = false;
      setIsUploading(false);
      if (uploadedAny) invalidateUploadQueries();
    }
  };

  const enqueue = (queued: UploadItem[]) => {
    if (queued.length === 0) return;
    pendingRef.current.push(...queued);
    void drain();
  };

  const start = (files: File[]) => {
    const queued = files.map(file => ({ id: newId(), file, status: "pending" as const, progress: 0 }));
    setItems(prev => [...prev, ...queued]);
    enqueue(queued);
  };

  const retry = (targets: UploadItem[]) => {
    const failed = targets.filter(it => it.status === "error");
    failed.forEach(it => patchItem(it.id, { status: "pending", progress: 0, error: undefined }));
    enqueue(failed.map(it => ({ ...it, status: "pending" as const, progress: 0, error: undefined })));
  };

  const reset = () => {
    if (drainingRef.current) return;
    setItems([]);
  };

  return { items, isUploading, start, retry, reset };
}
