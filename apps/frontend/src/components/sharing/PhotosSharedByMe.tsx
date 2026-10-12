import { Stack, Text } from "@mantine/core";
import { IconPhoto as Photo } from "@tabler/icons-react";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useFetchPhotoSharesQuery, useFetchSharedPhotosByMeQuery } from "../../api_client/photos/hooks";
import { useFetchUserListQuery } from "../../api_client/user/hooks";
import { PageLoader } from "../common/PageLoader";
import { PhotoListView } from "../photolist/PhotoListView";
import { sharerPhotoGroups } from "./sharerGroups";

export function PhotosSharedByMe() {
  const { t } = useTranslation();
  // isLoading, not isFetching: a background refetch replaced every list with
  // the loader and lost the scroll position.
  const { data: photos = [], isLoading } = useFetchSharedPhotosByMeQuery();
  // The photo links listed above this panel (same query, no extra request).
  const { data: shares = [], isLoading: isLoadingShares } = useFetchPhotoSharesQuery();
  const { data: users } = useFetchUserListQuery();
  // Stable while the data is: the photo list lays out again on every new photoset
  const photoset = useMemo(
    () =>
      sharerPhotoGroups(photos, users, {
        fallbackName: userId => `${userId}`,
        countLabel: count => t("sharing.youSharedPhotos", { count }),
      }),
    [photos, users, t]
  );
  // A photo shared with two users is in both groups, and so twice in the lightbox order
  const idx2hash = useMemo(() => photos.flatMap(group => group.photos), [photos]);

  if (isLoading) {
    return <PageLoader label={t("sharing.loadingPhotosSharedByYou")} />;
  }

  if (photos.length === 0) {
    // Not under a list of photo links: those are shared photos too.
    return isLoadingShares || shares.length > 0 ? null : (
      <Stack align="center" mt="xl">
        <Text c="dimmed">{t("sharing.noPhotosSharedByYou")}</Text>
      </Stack>
    );
  }

  return (
    <PhotoListView
      title={t("sidemenu.photos")}
      loading={false}
      icon={Photo}
      photoset={photoset}
      idx2hash={idx2hash}
      isPublic
      // Under the page header: no sticky header of its own, each group names its user
      header={null}
      selectable={false}
    />
  );
}
