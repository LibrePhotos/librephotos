import type { TFunction } from "i18next";
import type { ReactNode } from "react";
import type { EmptyStateConfig } from "../photolist/PhotoListView";
import type { AlbumUpload } from "../upload/useAlbumUpload";

/**
 * What the owner sees in an album without photos (#612): a drop zone with an "Upload photos"
 * button when the album can take uploads, else how to fill it from the library (or why not, for a
 * locked album).
 */
export function emptyAlbumState(t: TFunction, icon: ReactNode, upload: AlbumUpload | null): EmptyStateConfig {
  const title = t("useralbum.empty.title");
  if (upload && !upload.reason) {
    return {
      icon,
      title,
      description: t("useralbum.empty.description"),
      actionLabel: t("useralbum.empty.action"),
      onAction: upload.open,
      dropZone: true,
    };
  }
  return { icon, title, description: upload?.reason ?? t("useralbum.empty.description_library") };
}
