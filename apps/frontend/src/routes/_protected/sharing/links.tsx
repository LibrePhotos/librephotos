import { Group, Loader, Stack, Tabs, Text, Title } from "@mantine/core";
import { IconLink } from "@tabler/icons-react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { useFetchDateAlbumsQuery, useFetchUserAlbumsQuery } from "../../../api_client/albums/hooks";
import { Photoset, PigPhoto } from "../../../api_client/photos/types";
import { PhotoListView } from "../../../components/photolist/PhotoListView";
import { getPhotosFlatFromGroupedByDate } from "../../../util/util";
import { PublicAlbumsGrid } from "../../../components/sharing/PublicAlbumsGrid";

export const Route = createFileRoute("/_protected/sharing/links")();

export function PublicLinksPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<string>("albums");

  // Fetch public albums (albums with public=true)
  const { data: userAlbums = [], isLoading: isLoadingAlbums } = useFetchUserAlbumsQuery();
  const publicAlbums = useMemo(() => userAlbums.filter(album => album.public), [userAlbums]);

  // Fetch public photos
  const { data: publicPhotosGrouped, isLoading: isLoadingPhotos } = useFetchDateAlbumsQuery({ photosetType: Photoset.PUBLIC });
  const [photosFlat, setPhotosFlat] = useState<PigPhoto[]>([]);

  useEffect(() => {
    if (publicPhotosGrouped) {
      setPhotosFlat(getPhotosFlatFromGroupedByDate(publicPhotosGrouped));
    }
  }, [publicPhotosGrouped]);

  const totalPhotos = photosFlat.filter(p => !p.isTemp).length;

  return (
    <Stack p="md">
      <Group>
        <IconLink size={32} stroke={1.5} color="var(--mantine-color-violet-6)" />
        <div>
          <Title order={2}>{t("sharing.publicLinks", "Public Links")}</Title>
          <Text c="dimmed" size="sm">
            {t("sharing.publicLinksDescription", "Albums and photos you've made public via shareable link")}
          </Text>
        </div>
      </Group>

      <Tabs value={activeTab} onChange={value => setActiveTab(value || "albums")}>
        <Tabs.List>
          <Tabs.Tab value="albums">
            {t("sidemenu.albums", "Albums")} ({publicAlbums.length})
          </Tabs.Tab>
          <Tabs.Tab value="photos">
            {t("photos.photos", "Photos")} ({totalPhotos})
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="albums" keepMounted={false}>
          {isLoadingAlbums ? (
            <Stack align="center" mt="xl">
              <Loader />
              <Text>{t("loading", "Loading...")}</Text>
            </Stack>
          ) : publicAlbums.length === 0 ? (
            <Stack align="center" mt="xl">
              <Text c="dimmed">{t("sharing.noPublicAlbums", "No albums have been made public via link")}</Text>
            </Stack>
          ) : (
            <PublicAlbumsGrid albums={publicAlbums} />
          )}
        </Tabs.Panel>

        <Tabs.Panel value="photos" keepMounted={false}>
          {isLoadingPhotos ? (
            <Stack align="center" mt="xl">
              <Loader />
              <Text>{t("loading", "Loading...")}</Text>
            </Stack>
          ) : totalPhotos === 0 ? (
            <Stack align="center" mt="xl">
              <Text c="dimmed">{t("sharing.noPublicPhotos", "No photos have been made public")}</Text>
            </Stack>
          ) : (
            <PhotoListView
              title={t("sharing.publicPhotos", "Public Photos")}
              loading={isLoadingPhotos}
              icon={<IconLink size={50} />}
              photoset={publicPhotosGrouped ?? []}
              idx2hash={photosFlat}
              selectable
            />
          )}
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

Route.update({ component: PublicLinksPage });
