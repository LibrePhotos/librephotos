import { Stack, Tabs } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconLink, IconPhoto } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { useFetchUserAlbumsQuery } from "../../../api_client/albums/hooks";
import { useFetchPhotoSharesQuery } from "../../../api_client/photos/hooks";
import { ListEmptyState } from "../../../components/common/ListEmptyState";
import { PageLoader } from "../../../components/common/PageLoader";
import { PageTabs } from "../../../components/common/PageTabs";
import { useListFailure } from "../../../components/common/useListFailure";
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
  const [isShareDialogOpen, { open: showShareDialog, close: hideShareDialog }] = useDisclosure(false);

  // Fetch public albums (albums with public=true)
  const userAlbumsQuery = useFetchUserAlbumsQuery();
  const { data: userAlbums = [], isLoading: isLoadingAlbums } = userAlbumsQuery;
  const albumsFailure = useListFailure(userAlbumsQuery);
  const sharesQuery = useFetchPhotoSharesQuery();
  const sharesFailure = useListFailure(sharesQuery);
  const publicAlbums = useMemo(() => userAlbums.filter(album => album.public), [userAlbums]);

  const openShareDialog = (id: string) => {
    setAlbumID(id);
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
  const { data: photoShares = [], isLoading: isLoadingShares } = sharesQuery;

  return (
    <>
      <PageHeader title={t("sharing.publicLinks")} subtitle={t("sharing.publicLinksDescription")} />
      <PageBody gap={0}>
        <PageTabs
          value={activeTab}
          onChange={value =>
            void navigate({ search: { tab: value === "photos" ? "photos" : undefined }, replace: true })
          }
          tabs={[
            { value: "albums", label: t("sidemenu.albums"), count: isLoadingAlbums ? undefined : publicAlbums.length },
            {
              value: "photos",
              label: t("photos.photos"),
              count: isLoadingPhotos || isLoadingShares ? undefined : totalPhotos + photoShares.length,
            },
          ]}
        >
          <Tabs.Panel value="albums">
            {isLoadingAlbums ? (
              <PageLoader label={t("loading")} />
            ) : publicAlbums.length === 0 ? (
              <ListEmptyState
                failure={albumsFailure}
                icon={<IconLink size={40} stroke={1.5} />}
                title={t("sharing.noPublicAlbums")}
                description={t("sharing.noPublicAlbumsHint")}
              />
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
                  <ListEmptyState
                    failure={sharesFailure}
                    icon={<IconPhoto size={40} stroke={1.5} />}
                    title={t("sharing.noPublicPhotos")}
                    description={t("sharing.noPublicPhotosHint")}
                  />
                )
              ) : (
                <PhotoListView
                  title={t("sharing.publicPhotos")}
                  loading={isLoadingPhotos}
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
        </PageTabs>

        <ModalAlbumShare isOpen={isShareDialogOpen} onRequestClose={hideShareDialog} albumID={albumID} />
      </PageBody>
    </>
  );
}
