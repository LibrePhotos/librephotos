import { Stack, Tabs } from "@mantine/core";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useFetchSharedAlbumsByMeQuery } from "../../../api_client/albums/hooks";
import { useFetchSharedPhotosByMeQuery } from "../../../api_client/photos/hooks";
import { PageTabs } from "../../../components/common/PageTabs";
import { PageBody } from "../../../components/PageBody";
import { PageHeader } from "../../../components/PageHeader";
import { validatePhotoSearch } from "../../../components/photolist/photoSearch";
import { AlbumsSharedByMe } from "../../../components/sharing/AlbumsSharedByMe";
import { PhotoSharesSection } from "../../../components/sharing/PhotoSharesSection";
import { PhotosSharedByMe } from "../../../components/sharing/PhotosSharedByMe";

export const Route = createFileRoute("/_protected/sharing/byme/$tab")({
  component: SharedByMe,
  validateSearch: validatePhotoSearch,
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
    <>
      <PageHeader
        title={tab === "photos" ? t("sharing.photosYouShared") : t("sharing.albumsYouShared")}
        subtitle={getSubHeader(tab)}
      />
      <PageBody gap={0}>
        {/* Controlled by the route: with defaultValue, Back changed the title
            but left the other tab showing. */}
        <PageTabs
          value={tab}
          onChange={value => void navigate({ to: `/sharing/byme/${value}/` })}
          tabs={[
            { value: "photos", label: t("sidemenu.photos") },
            { value: "albums", label: t("sidemenu.albums") },
          ]}
        >
          <Tabs.Panel value="photos">
            <Stack gap="md" pt="md">
              <PhotoSharesSection />
              <PhotosSharedByMe />
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="albums" pt="md">
            <AlbumsSharedByMe />
          </Tabs.Panel>
        </PageTabs>
      </PageBody>
    </>
  );
}
