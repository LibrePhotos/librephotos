import { Anchor, Group, Text } from "@mantine/core";
import { IconBookmark } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import classes from "./UploadProgressCard.module.css";
import type { UploadAlbumTarget, UploadItem } from "./useUploadQueue";

/** The album every file of the list goes into, or null for the library or a mix of albums. */
function commonAlbum(items: UploadItem[]): UploadAlbumTarget | null {
  const first = items[0]?.album;
  if (!first) return null;
  return items.every(item => item.album?.id === first.id) ? first : null;
}

/** Files that ended up in the album: uploaded into it, or already in the library and added. */
const filedCount = (items: UploadItem[]) =>
  items.filter(
    item => (item.status === "done" && item.albumOutcome !== "library_only") || item.albumOutcome === "added_existing"
  ).length;

/**
 * The upload card's line naming the album the files go into (#612): "Adding to Porto 2025", then
 * how many landed there with a link to open it. Hidden for an upload into the library alone.
 */
export function UploadAlbumStrip({ items, isUploading }: { items: UploadItem[]; isUploading: boolean }) {
  const { t } = useTranslation();
  const album = commonAlbum(items);
  if (!album) return null;
  const filed = filedCount(items);
  return (
    <Group
      justify="space-between"
      wrap="nowrap"
      gap="xs"
      px="md"
      py={6}
      className={classes.albumStrip}
      data-testid="upload-album-strip"
    >
      <Group gap={6} wrap="nowrap" miw="0">
        <IconBookmark size={14} className={classes.fileIcon} />
        <Text size="xs" truncate>
          {isUploading
            ? t("upload.album.adding", { title: album.title })
            : t("upload.album.added", { count: filed, title: album.title })}
        </Text>
      </Group>
      {!isUploading && filed > 0 && (
        <Anchor
          size="xs"
          className={classes.noShrink}
          // renderRoot, not component={Link}: only this way are `to` and `params` type-checked
          renderRoot={props => <Link to="/album/user/$id" params={{ id: String(album.id) }} {...props} />}
        >
          {t("upload.album.open")}
        </Anchor>
      )}
    </Group>
  );
}

/** Under a file's name: how filing it into its album came out, where that is worth saying. */
export function AlbumOutcomeNote({ item }: { item: UploadItem }) {
  const { t } = useTranslation();
  if (item.albumOutcome === "added_existing") {
    return (
      <Text size="xs" c="dimmed" mt={4} lh={1.3}>
        {t("upload.album.existing_added")}
      </Text>
    );
  }
  if (item.albumOutcome === "library_only") {
    return (
      <Text size="xs" c="orange" mt={4} lh={1.3}>
        {t("upload.album.library_only")}
      </Text>
    );
  }
  return null;
}
