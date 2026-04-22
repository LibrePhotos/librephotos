import { Group, Stack, Tabs, Text, Title } from "@mantine/core";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useFetchSharedAlbumsByMeQuery } from "../../../api_client/albums/hooks";
import { useFetchSharedPhotosByMeQuery } from "../../../api_client/photos/hooks";
import { AlbumsSharedByMe } from "../../../components/sharing/AlbumsSharedByMe";
import { PhotosSharedByMe } from "../../../components/sharing/PhotosSharedByMe";

export const Route = createFileRoute("/_protected/sharing/byme/$tab")();

export function SharedByMe() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: albums = [] } = useFetchSharedAlbumsByMeQuery();
  const { data: photos = [] } = useFetchSharedPhotosByMeQuery();
  const { tab } = Route.useParams();

  const getSubHeader = (item = "photos") => {
    if (item === "photos") {
      return (
        <Text>
          {t("sharing.photoSharesWithUsers", {
            photoCount: photos.length,
            userCount: photos.flatMap(g => g.userId).length,
          })}
        </Text>
      );
    }
    // albums is grouped by recipient, so we need to count total unique albums
    const totalAlbums = new Set(albums.flatMap(g => g.albums.map(a => a.id))).size;
    return <Text>{t("sharing.youSharedAlbums", { count: totalAlbums })}</Text>;
  };

  return (
    <Stack p="md">
      <Group>
        <div>
          <Title order={2}>{tab === "photos" ? t("sharing.photosYouShared") : t("sharing.albumsYouShared")}</Title>
          <Text c="dimmed" size="sm">
            {getSubHeader(tab)}
          </Text>
        </div>
      </Group>
      <Tabs defaultValue={tab} onChange={value => navigate({ to: `/sharing/byme/${value}/` })}>
        <Tabs.List>
          <Tabs.Tab value="photos">{t("sidemenu.photos")}</Tabs.Tab>
          <Tabs.Tab value="albums">{t("sidemenu.albums")}</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="photos" keepMounted={false}>
          <PhotosSharedByMe />
        </Tabs.Panel>

        <Tabs.Panel value="albums" keepMounted={false}>
          <AlbumsSharedByMe />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

Route.update({ component: SharedByMe });
