import React, { createContext, useContext } from "react";
import { useScreenWakeLock } from "../../hooks/useScreenWakeLock";
import { useUploadQueue, type UploadQueue } from "./useUploadQueue";

const UploadContext = createContext<UploadQueue | null>(null);

/**
 * Lives at the protected app shell so the queue keeps running, and the
 * floating progress card stays visible, while the user browses elsewhere.
 */
export function UploadProvider({ children }: { children: React.ReactNode }) {
  const queue = useUploadQueue();
  useScreenWakeLock(queue.isUploading);
  return <UploadContext.Provider value={queue}>{children}</UploadContext.Provider>;
}

export function useUpload(): UploadQueue {
  const ctx = useContext(UploadContext);
  if (!ctx) {
    throw new Error("useUpload must be used within an UploadProvider");
  }
  return ctx;
}
