import type { UserAlbumInfo } from "@librephotos/api-client";
import { Text } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { useFetchSharedAlbumsWithMeQuery } from "../../../api_client/albums/hooks";
import { fuzzyMatch } from "../../../util/util";
import { sharerName } from "../../sharing/sharerGroups";
import classes from "./AlbumEditModal.module.css";
import { AlbumPickerRow } from "./AlbumPickerRow";

type Props = Readonly<{
  filter: string;
  onPick: (album: UserAlbumInfo) => void;
}>;

/** The albums someone shared with you as a contributor (#464), which you can add your photos to. */
function useContributableAlbums(): UserAlbumInfo[] {
  const { data: groups = [] } = useFetchSharedAlbumsWithMeQuery();
  return groups.flatMap(group => group.albums).filter(album => album.my_role === "contributor");
}

/**
 * The "Shared with you, you can add" group of the add-to-album dialog's one list (#464). Picking
 * one goes on to the step that says who will see the photos; a locked album says why it takes none.
 */
export function SharedAlbumsYouCanAdd({ filter, onPick }: Props) {
  const { t } = useTranslation();
  const albums = useContributableAlbums().filter(album => fuzzyMatch(filter, album.title));
  if (albums.length === 0) return null;
  return (
    <>
      <Text className={classes.groupLabel}>{t("collab.sharedYouCanAdd")}</Text>
      {albums.map(album => (
        <AlbumPickerRow
          key={`sa-${album.id}`}
          title={album.title}
          meta={t("collab.ownerAndMembers", {
            owner: sharerName(album.owner, album.owner.username),
            count: album.shared_to.length,
          })}
          cover={album.cover_photo}
          locked={album.locked}
          onPick={() => onPick(album)}
        />
      ))}
    </>
  );
}
