import { Stack, Tabs } from "@mantine/core";
import { IconDownload } from "@tabler/icons-react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useFetchSharedAlbumsWithMeQuery } from "../../../api_client/albums/hooks";
import { useFetchSharedPhotosWithMeQuery } from "../../../api_client/photos/hooks";
import { AlbumsSharedWithMe } from "../../../components/sharing/AlbumsSharedWithMe";
import { PhotosSharedWithMe } from "../../../components/sharing/PhotosSharedWithMe";
import { SharingPageHeader } from "../../../components/sharing/SharingPageHeader";

export const Route = createFileRoute("/_protected/sharing/withme/$tab")({
  component: SharedWithMe,
});

function SharedWithMe() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: albums = [] } = useFetchSharedAlbumsWithMeQuery();
  const { data: photos = [] } = useFetchSharedPhotosWithMeQuery();
  const { tab } = Route.useParams();

  // Plain strings: the header renders them in its own <Text>.
  const getSubHeader = (item = "photos") => {
    if (item === "photos") {
      // Grouped per owner: one group per user who shared.
      const userCount = photos.length;
      const photoCount = photos.reduce((n, group) => n + group.photos.length, 0);
      return t("sharing.usersSharedPhotosWithYou", {
        users: t("sharing.userCount", { count: userCount }),
        photos: t("sharing.photoCount", { count: photoCount }),
        // The numbers too, for translations that still use them.
        userCount,
        photoCount,
      });
    }
    const userCount = albums.length;
    const albumCount = albums.map(el => el.albums.length).reduce((a, b) => a + b, 0);
    return t("sharing.usersSharedAlbumsWithYou", {
      users: t("sharing.userCount", { count: userCount }),
      albums: t("explore.albumCount", { count: albumCount }),
      userCount,
      albumCount,
    });
  };

  return (
    <Stack p="md" gap={0}>
      <SharingPageHeader
        icon={IconDownload}
        color="var(--mantine-color-green-6)"
        title={tab === "photos" ? t("sharing.photosOthersShared") : t("sharing.albumsOthersShared")}
        subtitle={getSubHeader(tab)}
      />
      {/* Controlled by the route: with defaultValue, Back changed the title
          but left the other tab showing. */}
      <Tabs value={tab} onChange={value => value && navigate({ to: `/sharing/withme/${value}/` })}>
        <Tabs.List>
          <Tabs.Tab value="photos">{t("sidemenu.photos")}</Tabs.Tab>
          <Tabs.Tab value="albums">{t("sidemenu.albums")}</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="photos" keepMounted={false} pt="md">
          <PhotosSharedWithMe />
        </Tabs.Panel>

        <Tabs.Panel value="albums" keepMounted={false} pt="md">
          <AlbumsSharedWithMe />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
