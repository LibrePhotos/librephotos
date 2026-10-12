import { Stack, Text } from "@mantine/core";
import { IconPhoto as Photo } from "@tabler/icons-react";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useFetchSharedPhotosWithMeQuery } from "../../api_client/photos/hooks";
import { useFetchUserListQuery } from "../../api_client/user/hooks";
import { PageLoader } from "../common/PageLoader";
import { PhotoListView } from "../photolist/PhotoListView";
import { sharerPhotoGroups } from "./sharerGroups";

export function PhotosSharedWithMe() {
  const { t } = useTranslation();
  // isLoading, not isFetching: a background refetch replaced every list with
  // the loader and lost the scroll position.
  const { data: photos = [], isLoading } = useFetchSharedPhotosWithMeQuery();
  const { data: users } = useFetchUserListQuery();
  // Stable while the data is: the photo list lays out again on every new photoset
  const photoset = useMemo(
    () =>
      sharerPhotoGroups(photos, users, {
        fallbackName: userId => `user(${userId})`,
        countLabel: count => t("sharing.sharedPhotosWithYou", { count }),
      }),
    [photos, users, t]
  );
  const idx2hash = useMemo(() => photos.flatMap(group => group.photos), [photos]);

  if (isLoading) {
    return <PageLoader label={t("sharing.loadingPhotosSharedWithYou")} />;
  }

  if (photos.length === 0) {
    return (
      <Stack align="center" mt="xl">
        <Text c="dimmed">{t("sharing.noPhotosSharedWithYou")}</Text>
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
