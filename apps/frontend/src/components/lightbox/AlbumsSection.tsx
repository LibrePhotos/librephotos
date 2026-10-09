import { Anchor, Group, Stack, Title } from "@mantine/core";
import { IconBookmark as Bookmark } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useFetchPhotoAlbumsQuery } from "../../api_client/photos/hooks";
import { AlbumListItem } from "../album/AlbumListItem";

type AlbumsSectionProps = {
  imageHash: string;
  showTitle?: boolean;
};

export function AlbumsSection({ imageHash, showTitle = true }: AlbumsSectionProps) {
  const { t } = useTranslation();
  const { data: albums } = useFetchPhotoAlbumsQuery(imageHash);

  if (!albums || albums.length === 0) return null;

  return (
    <div>
      {showTitle && (
        <Group>
          <Bookmark />
          <Title order={4}>{t("lightbox.sidebar.albums", "Albums")}</Title>
        </Group>
      )}
      <Stack gap="xs" mt="xs">
        {albums.map(album => (
          <Anchor
            key={album.id}
            underline="never"
            // A router link, not a plain href, so opening an album does not reload the app.
            renderRoot={rootProps => <Link {...rootProps} to="/album/user/$id" params={{ id: String(album.id) }} />}
          >
            <AlbumListItem album={album} />
          </Anchor>
        ))}
      </Stack>
    </div>
  );
}
