import type { UserAlbumInfo } from "@librephotos/api-client";
import { Badge, Group, Stack, Text, UnstyledButton } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { useFetchSharedAlbumsWithMeQuery } from "../../../api_client/albums/hooks";
import { fuzzyMatch } from "../../../util/util";
import { AlbumListItem } from "../../album/AlbumListItem";
import { sharerName } from "../../sharing/sharerGroups";

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
 * The "Shared with you, you can add" group of the add-to-album dialog (#464). Picking one goes on
 * to the step that says who will see the photos; a locked album says why it takes none.
 */
export function SharedAlbumsYouCanAdd({ filter, onPick }: Props) {
  const { t } = useTranslation();
  const albums = useContributableAlbums().filter(album => fuzzyMatch(filter, album.title));
  if (albums.length === 0) return null;
  return (
    <Stack gap="xs">
      <Text size="sm" fw={600} c="dimmed">
        {t("collab.sharedYouCanAdd")}
      </Text>
      {albums.map(album => (
        <UnstyledButton
          key={`sa-${album.id}`}
          disabled={album.locked}
          aria-label={album.locked ? t("useralbum.lockedCannotAdd", { title: album.title }) : undefined}
          onClick={() => {
            if (!album.locked) onPick(album);
          }}
        >
          <Stack gap={2}>
            <Group gap="xs" wrap="nowrap">
              <AlbumListItem album={album} />
              {album.locked && <Badge color="gray">{t("useralbum.locked")}</Badge>}
            </Group>
            <Text size="xs" c="dimmed">
              {t("collab.ownerAndMembers", {
                owner: sharerName(album.owner, album.owner.username),
                count: album.shared_to.length,
              })}
            </Text>
          </Stack>
        </UnstyledButton>
      ))}
    </Stack>
  );
}
