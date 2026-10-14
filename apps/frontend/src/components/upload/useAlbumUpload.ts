import type React from "react";
import { useDropzone } from "react-dropzone";
import { useTranslation } from "react-i18next";
import { UPLOAD_ACCEPT } from "./uploadAccept";
import { useRegisterDropAlbum, useUpload } from "./UploadContext";
import { useCanUpload } from "./useCanUpload";

/** The owner's album an album page uploads into. */
export type UploadableAlbum = { id: number; title: string; locked: boolean };

/** Uploading into one album from its page (#612): the "⋮" item and the empty album's button. */
export type AlbumUpload = {
  /** Opens the file picker; the chosen files are uploaded into the album. */
  open: () => void;
  /** Why the album cannot take uploads now (locked, no scan directory), or null when it can. */
  reason: string | null;
  /** The hidden file input the picker needs: render it once on the page. */
  inputProps: React.InputHTMLAttributes<HTMLInputElement>;
};

function useRefusal(album: UploadableAlbum | null, ready: boolean): string | null {
  const { t } = useTranslation();
  if (album?.locked) return t("useralbum.lockedCannotAdd", { title: album.title });
  if (!ready) return t("toasts.scan_directory_required");
  return null;
}

/**
 * Upload into `album` from its page: a file picker whose files go into the album, and the page's
 * drop target pointed at it. Null when uploads are off, or for an album that is not the user's
 * own (`album` null): a shared album takes no uploads (until #464).
 */
export function useAlbumUpload(album: UploadableAlbum | null): AlbumUpload | null {
  const availability = useCanUpload();
  const { start } = useUpload();
  const target = album ? { id: album.id, title: album.title } : null;
  useRegisterDropAlbum(album ? { album: { id: album.id, title: album.title }, locked: album.locked } : null);
  const usable = availability === "ready" && album !== null && !album.locked;

  const { getInputProps, open } = useDropzone({
    accept: UPLOAD_ACCEPT,
    noDrag: true,
    noClick: true,
    noKeyboard: true,
    preventDropOnDocument: false,
    onDrop: files => {
      if (target && files.length > 0) start(files, target);
    },
    disabled: !usable,
  });
  const reason = useRefusal(album, availability === "ready");

  if (availability === "off" || album === null) return null;
  return { open, reason, inputProps: getInputProps() };
}
