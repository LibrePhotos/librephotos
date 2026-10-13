import type { UserAlbumInfo } from "@librephotos/api-client";
import { Group, Text } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { parseInstant } from "../../util/dateUtils";
import { Tile } from "../Tile";
import classes from "./AlbumListItem.module.css";

type AlbumListItemProps = {
  album: UserAlbumInfo;
  showUpdatedTime?: boolean;
};

export function AlbumListItem({ album, showUpdatedTime = false }: AlbumListItemProps) {
  const { t } = useTranslation();

  return (
    <Group wrap="nowrap">
      {album.cover_photo && (
        <Tile
          height={50}
          width={50}
          className={classes.albumTile}
          image_hash={album.cover_photo.image_hash}
          video={album.cover_photo.video}
        />
      )}
      <div>
        <Text size="sm" fw={500}>
          {album.title}
        </Text>
        <Text size="xs" c="dimmed">
          {t("modalalbum.items", { count: album.photo_count })}
          {showUpdatedTime && (
            <>
              <br />
              {/* The list only knows when the album was created, not when it last changed */}
              {t("modalalbum.created", {
                duration: parseInstant(album.created_on).toRelative(),
              })}
            </>
          )}
        </Text>
      </div>
    </Group>
  );
}
