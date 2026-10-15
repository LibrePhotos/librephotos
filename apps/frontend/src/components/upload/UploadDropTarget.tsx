import React from "react";
import { useDropzone } from "react-dropzone";
import { UPLOAD_ACCEPT } from "./uploadAccept";
import { useDropAlbum, useUpload, type DropAlbum } from "./UploadContext";
import { UploadDropOverlay, type DropVerdict } from "./UploadDropOverlay";
import { useCanUpload, type UploadAvailability } from "./useCanUpload";
import { useInPageDragRef } from "./useInPageDragRef";

function dropVerdict(availability: UploadAvailability, isDragReject: boolean, isUploading: boolean): DropVerdict {
  if (availability !== "ready") return "no_scan_directory";
  if (isDragReject) return "reject";
  return isUploading ? "add" : "accept";
}

const albumTarget = (dropAlbum: DropAlbum | null) => (dropAlbum && !dropAlbum.locked ? dropAlbum.album : undefined);

/**
 * Makes the whole protected shell a drop target for uploads, with a
 * full-window overlay while files are dragged over it. Without a scan
 * directory the overlay explains why a drop does nothing; with uploads turned
 * off there is neither overlay nor upload, and a drop still never opens the
 * file in the tab.
 */
export function UploadDropTarget({ children }: { children: React.ReactNode }) {
  const availability = useCanUpload();
  const { start, isUploading } = useUpload();
  // On an album page, a drop files into its album; a locked album takes nothing (#612).
  const dropAlbum = useDropAlbum();
  const inPageDragRef = useInPageDragRef();

  const { getRootProps, isDragActive, isDragReject } = useDropzone({
    accept: UPLOAD_ACCEPT,
    noClick: true,
    noKeyboard: true,
    disabled: availability === "off",
    onDrop: files => {
      if (availability === "ready" && files.length > 0) start(files, albumTarget(dropAlbum));
    },
  });

  // A drag that started on the page (a thumbnail) is not an upload: stopping the event here keeps
  // react-dropzone from seeing it, which it checks before running its own handler.
  const ignoreInPageDrag = (event: React.DragEvent) => {
    if (inPageDragRef.current) event.stopPropagation();
  };

  return (
    <div
      {...getRootProps({
        onDragEnter: ignoreInPageDrag,
        onDragOver: ignoreInPageDrag,
        onDragLeave: ignoreInPageDrag,
        onDrop: ignoreInPageDrag,
      })}
    >
      {children}
      {isDragActive && (
        <UploadDropOverlay verdict={dropVerdict(availability, isDragReject, isUploading)} album={dropAlbum} />
      )}
    </div>
  );
}
