import type { FolderSubfolder } from "@librephotos/api-client";
import { IconFolder } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { CollectionCard } from "../common/CollectionCard";

type Props = Readonly<{
  folder: Pick<FolderSubfolder, "cover_photo" | "name" | "path" | "photo_count">;
  size: number;
}>;

/**
 * A Folders page card (#2233): the folder's newest photo with a small folder glyph, so a folder
 * still reads as one next to an album; the folder icon when the server sends no cover.
 */
export function FolderCoverTile({ folder, size }: Props) {
  const { t } = useTranslation();
  const cover = folder.cover_photo;
  const hasCover = Boolean(cover?.image_hash);
  return (
    <CollectionCard
      size={size}
      title={folder.name}
      meta={t("numberofphotos", { count: folder.photo_count, number: folder.photo_count })}
      covers={cover?.image_hash ? [cover] : []}
      placeholder={<IconFolder />}
      // Decoration: the link is named after the folder
      badges={
        hasCover ? (
          <span aria-hidden>
            <IconFolder size={16} stroke={2} />
          </span>
        ) : null
      }
      renderLink={props => <Link {...props} to="/album/folder/$id" params={{ id: encodeURIComponent(folder.path) }} />}
    />
  );
}
