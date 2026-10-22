import { Tabs } from "@mantine/core";
import { IconDownload } from "@tabler/icons-react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ParseKeys } from "i18next";
import React from "react";
import { useTranslation } from "react-i18next";
import { useFetchSharedAlbumsWithMeQuery } from "../../../api_client/albums/hooks";
import { useFetchSharedPhotosWithMeQuery } from "../../../api_client/photos/hooks";
import { PageBody } from "../../../components/PageBody";
import { PageHeader } from "../../../components/PageHeader";
import { validatePhotoSearch } from "../../../components/photolist/photoSearch";
import { AlbumsSharedWithMe } from "../../../components/sharing/AlbumsSharedWithMe";
import { PeopleSharedWithMe } from "../../../components/sharing/PeopleSharedWithMe";
import { PhotosSharedWithMe } from "../../../components/sharing/PhotosSharedWithMe";
import { SharedGroupsWithMe } from "../../../components/sharing/SharedGroupsWithMe";
import classes from "../../../components/sharing/SharedWithMe.module.css";

export const Route = createFileRoute("/_protected/sharing/withme/$tab")({
  component: SharedWithMe,
  validateSearch: validatePhotoSearch,
});

// What each tab's header says; an unknown tab reads as the Photos tab.
const TAB_TITLES: Partial<Record<string, ParseKeys>> = {
  photos: "sharing.photosOthersShared",
  albums: "sharing.albumsOthersShared",
  places: "sharing.placesOthersShared",
  things: "sharing.thingsOthersShared",
  people: "sharing.peopleOthersShared",
};

const TAB_DESCRIPTIONS: Partial<Record<string, ParseKeys>> = {
  places: "sharing.placesSharedWithYouDesc",
  things: "sharing.thingsSharedWithYouDesc",
  people: "sharing.peopleSharedWithYouDesc",
};

function SharedWithMe() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: albums = [] } = useFetchSharedAlbumsWithMeQuery();
  const { data: photos = [] } = useFetchSharedPhotosWithMeQuery();
  const { tab } = Route.useParams();

  // Plain strings: the header renders them in its own <Text>.
  const getSubHeader = (item: string) => {
    // The places, things and people of the shared photos (#2721, #2722) say what they group.
    const description = TAB_DESCRIPTIONS[item];
    if (description) return t(description);
    if (item === "albums") {
      const userCount = albums.length;
      const albumCount = albums.map(el => el.albums.length).reduce((a, b) => a + b, 0);
      return t("sharing.usersSharedAlbumsWithYou", {
        users: t("sharing.userCount", { count: userCount }),
        albums: t("explore.albumCount", { count: albumCount }),
        userCount,
        albumCount,
      });
    }
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
  };

  return (
    <>
      <PageHeader
        icon={IconDownload}
        iconColor="var(--mantine-color-green-6)"
        title={t(TAB_TITLES[tab] ?? "sharing.photosOthersShared")}
        subtitle={getSubHeader(tab)}
      />
      <PageBody gap={0}>
        {/* Controlled by the route: with defaultValue, Back changed the title
            but left the other tab showing. */}
        <Tabs value={tab} onChange={value => value && navigate({ to: `/sharing/withme/${value}/` })}>
          <Tabs.List className={classes.tabList}>
            <Tabs.Tab value="photos">{t("sidemenu.photos")}</Tabs.Tab>
            <Tabs.Tab value="albums">{t("sidemenu.albums")}</Tabs.Tab>
            <Tabs.Tab value="places">{t("sidemenu.places")}</Tabs.Tab>
            <Tabs.Tab value="things">{t("sidemenu.things")}</Tabs.Tab>
            <Tabs.Tab value="people">{t("sidemenu.people")}</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="photos" pt="md">
            <PhotosSharedWithMe />
          </Tabs.Panel>

          <Tabs.Panel value="albums" pt="md">
            <AlbumsSharedWithMe />
          </Tabs.Panel>

          <Tabs.Panel value="places" pt="md">
            <SharedGroupsWithMe kind="places" />
          </Tabs.Panel>

          <Tabs.Panel value="things" pt="md">
            <SharedGroupsWithMe kind="things" />
          </Tabs.Panel>

          <Tabs.Panel value="people" pt="md">
            <PeopleSharedWithMe />
          </Tabs.Panel>
        </Tabs>
      </PageBody>
    </>
  );
}
