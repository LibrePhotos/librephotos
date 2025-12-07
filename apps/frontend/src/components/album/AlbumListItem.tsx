import { Group, Text } from "@mantine/core";
import { DateTime } from "luxon";
import React from "react";
import { useTranslation } from "react-i18next";

import type { UserAlbumInfo } from "../../api_client/albums/types";
import { i18nResolvedLanguage } from "../../i18n";
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
              {t("modalalbum.updated", {
                duration: DateTime.fromISO(album.created_on).setLocale(i18nResolvedLanguage()).toRelative(),
              })}
            </>
          )}
        </Text>
      </div>
    </Group>
  );
}


