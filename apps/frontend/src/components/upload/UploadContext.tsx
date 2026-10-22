import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useBeforeUnloadWarning } from "../../hooks/useBeforeUnloadWarning";
import { useScreenWakeLock } from "../../hooks/useScreenWakeLock";
import { useUploadProcessing, type UploadProcessing } from "./useUploadProcessing";
import { useUploadQueue, type UploadAlbumTarget, type UploadQueue } from "./useUploadQueue";

const UploadContext = createContext<UploadQueue | null>(null);
// Its own context: the account menu and the timeline read the server side without the queue.
const UploadProcessingContext = createContext<UploadProcessing | null>(null);

/**
 * The album files dropped anywhere on the page go into (#612): the owner's album page names its
 * album here. A locked album still shows in the drop overlay, which says the files go to the
 * library only.
 */
export type DropAlbum = { album: UploadAlbumTarget; locked: boolean };

type DropAlbumState = { dropAlbum: DropAlbum | null; setDropAlbum: (album: DropAlbum | null) => void };

// Its own context, so an album page registering itself does not re-render every queue consumer.
const DropAlbumContext = createContext<DropAlbumState>({ dropAlbum: null, setDropAlbum: () => {} });

/**
 * Lives at the protected app shell so the queue keeps running, and the
 * floating progress card stays visible, while the user browses elsewhere.
 * Closing or reloading the tab would drop the queue, so that asks first.
 */
export function UploadProvider({ children }: { children: React.ReactNode }) {
  const queue = useUploadQueue();
  const processing = useUploadProcessing(queue.items, queue.isUploading);
  const [dropAlbum, setDropAlbum] = useState<DropAlbum | null>(null);
  const dropAlbumState = useMemo(() => ({ dropAlbum, setDropAlbum }), [dropAlbum]);
  useScreenWakeLock(queue.isUploading);
  useBeforeUnloadWarning(queue.isUploading);
  return (
    <UploadContext.Provider value={queue}>
      <UploadProcessingContext.Provider value={processing}>
        <DropAlbumContext.Provider value={dropAlbumState}>{children}</DropAlbumContext.Provider>
      </UploadProcessingContext.Provider>
    </UploadContext.Provider>
  );
}

export function useUpload(): UploadQueue {
  const ctx = useContext(UploadContext);
  if (!ctx) {
    throw new Error("useUpload must be used within an UploadProvider");
  }
  return ctx;
}

/** The queue, or null outside the protected shell (public pages share the account menu). */
export function useOptionalUpload(): UploadQueue | null {
  return useContext(UploadContext);
}

/**
 * What the server does with the user's uploads (#2739), or null outside the protected shell (public
 * pages share the account menu).
 */
export function useOptionalUploadProcessing(): UploadProcessing | null {
  return useContext(UploadProcessingContext);
}

/** The album a drop on the current page files into, if the page named one. */
export function useDropAlbum(): DropAlbum | null {
  return useContext(DropAlbumContext).dropAlbum;
}

/** Names the album drops on this page go into, while the calling page is mounted. */
export function useRegisterDropAlbum(target: DropAlbum | null): void {
  const { setDropAlbum } = useContext(DropAlbumContext);
  const id = target?.album.id;
  const title = target?.album.title;
  const locked = target?.locked;
  useEffect(() => {
    if (id === undefined || title === undefined || locked === undefined) return undefined;
    setDropAlbum({ album: { id, title }, locked });
    return () => setDropAlbum(null);
  }, [id, title, locked, setDropAlbum]);
}
