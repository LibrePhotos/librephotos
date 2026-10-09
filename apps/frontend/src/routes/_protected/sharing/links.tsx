import { Loader, Stack, Tabs, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconLink } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { useFetchDateAlbumsQuery, useFetchUserAlbumsQuery } from "../../../api_client/albums/hooks";
import { useFetchPhotoSharesQuery } from "../../../api_client/photos/hooks";
import { Photoset, PigPhoto } from "../../../api_client/photos/types";
import { PhotoListView } from "../../../components/photolist/PhotoListView";
import { ModalAlbumShare } from "../../../components/sharing/ModalAlbumShare";
import { PhotoSharesSection } from "../../../components/sharing/PhotoSharesSection";
import { PublicAlbumsGrid } from "../../../components/sharing/PublicAlbumsGrid";
import { SharingPageHeader } from "../../../components/sharing/SharingPageHeader";
import { getPhotosFlatFromGroupedByDate } from "../../../util/util";

const PublicLinksTab = z.enum(["albums", "photos"]);
type PublicLinksTab = z.infer<typeof PublicLinksTab>;

type PublicLinksSearch = {
  tab?: PublicLinksTab;
};

export const Route = createFileRoute("/_protected/sharing/links")({
  component: PublicLinksPage,
  // The tab lives in the URL, so the overview's photo previews can open the
  // Photos tab and a return from an album lands on the tab it left.
  validateSearch: (search: Record<string, unknown>): PublicLinksSearch => ({
    tab: PublicLinksTab.safeParse(search.tab).data,
  }),
});

function PublicLinksPage() {
  const { t } = useTranslation();
  const navigate = Route.useNavigate();
  const activeTab: PublicLinksTab = Route.useSearch().tab ?? "albums";
  const [albumID, setAlbumID] = useState("");
  const [albumOwner, setAlbumOwner] = useState("");
  const [isShareDialogOpen, { open: showShareDialog, close: hideShareDialog }] = useDisclosure(false);

  // Fetch public albums (albums with public=true)
  const { data: userAlbums = [], isLoading: isLoadingAlbums } = useFetchUserAlbumsQuery();
  const publicAlbums = useMemo(() => userAlbums.filter(album => album.public), [userAlbums]);

  const openShareDialog = (id: string, _title: string, ownerUsername: string) => {
    setAlbumID(id);
    setAlbumOwner(ownerUsername);
    showShareDialog();
  };

  // Fetch public photos
  const { data: publicPhotosGrouped, isLoading: isLoadingPhotos } = useFetchDateAlbumsQuery({
    photosetType: Photoset.PUBLIC,
  });
  const [photosFlat, setPhotosFlat] = useState<PigPhoto[]>([]);

  useEffect(() => {
    if (publicPhotosGrouped) {
      setPhotosFlat(getPhotosFlatFromGroupedByDate(publicPhotosGrouped));
    }
  }, [publicPhotosGrouped]);

  const totalPhotos = photosFlat.filter(p => !p.isTemp).length;
  // The per-photo share links belong here too, as the docs say; they were only
  // listed under "You shared".
  const { data: photoShares = [], isLoading: isLoadingShares } = useFetchPhotoSharesQuery();

  return (
    <Stack p="md" gap={0}>
      <SharingPageHeader
        icon={IconLink}
        color="var(--mantine-color-violet-6)"
        title={t("sharing.publicLinks", "Public Links")}
        subtitle={t("sharing.publicLinksDescription", "Albums and photos you've made public via shareable link")}
      />

      <Tabs
        value={activeTab}
        onChange={value => navigate({ search: { tab: value === "photos" ? "photos" : undefined }, replace: true })}
      >
        <Tabs.List>
          <Tabs.Tab value="albums">
            {t("sidemenu.albums", "Albums")} ({publicAlbums.length})
          </Tabs.Tab>
          <Tabs.Tab value="photos">
            {t("photos.photos", "Photos")} ({totalPhotos + photoShares.length})
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
            <PublicAlbumsGrid albums={publicAlbums} onShare={openShareDialog} />
          )}
        </Tabs.Panel>

        <Tabs.Panel value="photos" keepMounted={false}>
          <Stack gap="md" pt="md">
            <PhotoSharesSection />
            {isLoadingPhotos || isLoadingShares ? (
              <Stack align="center" mt="xl">
                <Loader />
                <Text>{t("loading", "Loading...")}</Text>
              </Stack>
            ) : totalPhotos === 0 ? (
              photoShares.length === 0 && (
                <Stack align="center" mt="xl">
                  <Text c="dimmed">{t("sharing.noPublicPhotos", "No photos have been made public")}</Text>
                </Stack>
              )
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
          </Stack>
        </Tabs.Panel>
      </Tabs>

      <ModalAlbumShare
        isOpen={isShareDialogOpen}
        onRequestClose={hideShareDialog}
        albumID={albumID}
        ownerUsername={albumOwner}
      />
    </Stack>
  );
}
