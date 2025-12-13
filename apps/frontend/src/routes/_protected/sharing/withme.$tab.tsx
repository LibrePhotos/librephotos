import { Group, Stack, Tabs, Text, Title } from "@mantine/core";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useFetchSharedAlbumsWithMeQuery } from "../../../api_client/albums/hooks";
import { useFetchSharedPhotosWithMeQuery } from "../../../api_client/photos/hooks";
import { AlbumsSharedWithMe } from "../../../components/sharing/AlbumsSharedWithMe";
import { PhotosSharedWithMe } from "../../../components/sharing/PhotosSharedWithMe";

export const Route = createFileRoute("/_protected/sharing/withme/$tab")();

export function SharedWithMe() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: albums = [] } = useFetchSharedAlbumsWithMeQuery();
  const { data: photos = [] } = useFetchSharedPhotosWithMeQuery();
  const { tab } = Route.useParams();

  const getSubHeader = (item = "photos") => {
    if (item === "photos") {
      return (
        <Text c="dimmed">
          {t("sharing.usersSharedPhotosWithYou", { 
            userCount: photos.flatMap(g => g.userId).length, 
            photoCount: photos.length 
          })}
        </Text>
      );
    }
    return (
      <Text c="dimmed">
        {t("sharing.usersSharedAlbumsWithYou", { 
          userCount: albums.length, 
          albumCount: albums.map(el => el.albums.length).reduce((a, b) => a + b, 0) 
        })}
      </Text>
    );
  };

  return (
    <Stack p="md">
      <Group>
        <div>
          <Title order={2}>
            {tab === "photos" ? t("sharing.photosOthersShared") : t("sharing.albumsOthersShared")}
          </Title>
          <Text c="dimmed" size="sm">
            {getSubHeader(tab)}
          </Text>
        </div>
      </Group>
      <Tabs defaultValue={tab} onChange={value => navigate({ to: `/sharing/withme/${value}/` })}>
        <Tabs.List>
          <Tabs.Tab value="photos">{t("sidemenu.photos")}</Tabs.Tab>
          <Tabs.Tab value="albums">{t("sidemenu.albums")}</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="photos" keepMounted={false}>
          <PhotosSharedWithMe />
        </Tabs.Panel>

        <Tabs.Panel value="albums" keepMounted={false}>
          <AlbumsSharedWithMe />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

Route.update({ component: SharedWithMe });
