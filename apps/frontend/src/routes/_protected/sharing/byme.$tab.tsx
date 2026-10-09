import { Stack, Tabs } from "@mantine/core";
import { IconUpload } from "@tabler/icons-react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useFetchSharedAlbumsByMeQuery } from "../../../api_client/albums/hooks";
import { useFetchSharedPhotosByMeQuery } from "../../../api_client/photos/hooks";
import { AlbumsSharedByMe } from "../../../components/sharing/AlbumsSharedByMe";
import { PhotoSharesSection } from "../../../components/sharing/PhotoSharesSection";
import { PhotosSharedByMe } from "../../../components/sharing/PhotosSharedByMe";
import { SharingPageHeader } from "../../../components/sharing/SharingPageHeader";

export const Route = createFileRoute("/_protected/sharing/byme/$tab")({
  component: SharedByMe,
});

function SharedByMe() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: albums = [] } = useFetchSharedAlbumsByMeQuery();
  const { data: photos = [] } = useFetchSharedPhotosByMeQuery();
  const { tab } = Route.useParams();

  // Plain strings: the header renders them in its own <Text>.
  const getSubHeader = (item = "photos") => {
    if (item === "photos") {
      // Grouped per recipient, so a photo shared with two users is in two groups.
      const photoCount = new Set(photos.flatMap(group => group.photos.map(photo => photo.id))).size;
      const userCount = photos.length;
      return t("sharing.photoSharesWithUsers", {
        photos: t("sharing.photoCount", { count: photoCount }),
        users: t("sharing.userCount", { count: userCount }),
        // The numbers too, for translations that still use them.
        photoCount,
        userCount,
      });
    }
    // albums is grouped by recipient, so we need to count total unique albums
    const totalAlbums = new Set(albums.flatMap(g => g.albums.map(a => a.id))).size;
    return t("sharing.youSharedAlbums", { count: totalAlbums });
  };

  return (
    <Stack p="md" gap={0}>
      <SharingPageHeader
        icon={IconUpload}
        color="var(--mantine-color-red-6)"
        title={tab === "photos" ? t("sharing.photosYouShared") : t("sharing.albumsYouShared")}
        subtitle={getSubHeader(tab)}
      />
      {/* Controlled by the route: with defaultValue, Back changed the title
          but left the other tab showing. */}
      <Tabs value={tab} onChange={value => value && navigate({ to: `/sharing/byme/${value}/` })}>
        <Tabs.List>
          <Tabs.Tab value="photos">{t("sidemenu.photos")}</Tabs.Tab>
          <Tabs.Tab value="albums">{t("sidemenu.albums")}</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="photos" keepMounted={false}>
          <Stack gap="md" pt="md">
            <PhotoSharesSection />
            <PhotosSharedByMe />
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="albums" keepMounted={false} pt="md">
          <AlbumsSharedByMe />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
