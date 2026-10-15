import { Stack, Tabs, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconLink } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { useFetchUserAlbumsQuery } from "../../../api_client/albums/hooks";
import { useFetchPhotoSharesQuery } from "../../../api_client/photos/hooks";
import { PageLoader } from "../../../components/common/PageLoader";
import { PageBody } from "../../../components/PageBody";
import { PageHeader } from "../../../components/PageHeader";
import { PhotoListView } from "../../../components/photolist/PhotoListView";
import { validatePhotoSearch, type PhotoSearch } from "../../../components/photolist/photoSearch";
import { ModalAlbumShare } from "../../../components/sharing/ModalAlbumShare";
import { PhotoSharesSection } from "../../../components/sharing/PhotoSharesSection";
import { PublicAlbumsGrid } from "../../../components/sharing/PublicAlbumsGrid";
import { useMyPublicPhotoDays } from "../../../components/sharing/useMyPublicPhotoDays";

const PublicLinksTab = z.enum(["albums", "photos"]);
type PublicLinksTab = z.infer<typeof PublicLinksTab>;

type PublicLinksSearch = {
  tab?: PublicLinksTab;
} & PhotoSearch;

export const Route = createFileRoute("/_protected/sharing/links")({
  component: PublicLinksPage,
  // The tab lives in the URL, so the overview's photo previews can open the
  // Photos tab and a return from an album lands on the tab it left.
  validateSearch: (search: Record<string, unknown>): PublicLinksSearch => ({
    tab: PublicLinksTab.safeParse(search.tab).data,
    ...validatePhotoSearch(search),
  }),
});

function PublicLinksPage() {
  const { t } = useTranslation();
  const navigate = Route.useNavigate();
  const activeTab: PublicLinksTab = Route.useSearch({ select: search => search.tab }) ?? "albums";
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

  // My public photos by day. Counted by the days' sizes: a day's photos are placeholders until
  // its page loads, so counting loaded photos showed none at all (#2686).
  const {
    days: publicPhotoDays,
    photosFlat,
    count: totalPhotos,
    isLoading: isLoadingPhotos,
    updateGroups,
  } = useMyPublicPhotoDays();
  // The per-photo share links belong here too, as the docs say; they were only
  // listed under "You shared".
  const { data: photoShares = [], isLoading: isLoadingShares } = useFetchPhotoSharesQuery();

  return (
    <>
      <PageHeader
        icon={IconLink}
        iconColor="var(--mantine-color-violet-6)"
        title={t("sharing.publicLinks")}
        subtitle={t("sharing.publicLinksDescription")}
      />
      <PageBody gap={0}>
        <Tabs
          value={activeTab}
          onChange={value => navigate({ search: { tab: value === "photos" ? "photos" : undefined }, replace: true })}
        >
          <Tabs.List>
            <Tabs.Tab value="albums">
              {t("sidemenu.albums")} ({publicAlbums.length})
            </Tabs.Tab>
            <Tabs.Tab value="photos">
              {t("photos.photos")} ({totalPhotos + photoShares.length})
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="albums">
            {isLoadingAlbums ? (
              <PageLoader label={t("loading")} />
            ) : publicAlbums.length === 0 ? (
              <Stack align="center" mt="xl">
                <Text c="dimmed">{t("sharing.noPublicAlbums")}</Text>
              </Stack>
            ) : (
              <PublicAlbumsGrid albums={publicAlbums} onShare={openShareDialog} />
            )}
          </Tabs.Panel>

          <Tabs.Panel value="photos">
            <Stack gap="md" pt="md">
              <PhotoSharesSection />
              {isLoadingPhotos || isLoadingShares ? (
                <PageLoader label={t("loading")} />
              ) : totalPhotos === 0 ? (
                photoShares.length === 0 && (
                  <Stack align="center" mt="xl">
                    <Text c="dimmed">{t("sharing.noPublicPhotos")}</Text>
                  </Stack>
                )
              ) : (
                <PhotoListView
                  title={t("sharing.publicPhotos")}
                  loading={isLoadingPhotos}
                  icon={IconLink}
                  photoset={publicPhotoDays}
                  updateGroups={updateGroups}
                  idx2hash={photosFlat}
                  selectable
                  // Keeps its header for the selection bar, under this page's h1
                  titleOrder={2}
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
      </PageBody>
    </>
  );
}
