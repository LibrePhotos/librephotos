import { Avatar, Loader, Stack, Text } from "@mantine/core";
import { IconPhoto as Photo, IconPolaroid as Polaroid } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useFetchPhotoSharesQuery, useFetchSharedPhotosByMeQuery } from "../../api_client/photos/hooks";
import { useFetchUserListQuery } from "../../api_client/user/hooks";
import { PhotoListView } from "../photolist/PhotoListView";
import { avatarSrc } from "./avatarSrc";

type GroupHeaderProps = {
  group: {
    userId: number;
    photos: readonly unknown[];
  };
  isSharedToMe: boolean;
};

function GroupHeader({ group, isSharedToMe }: Readonly<GroupHeaderProps>) {
  const { t } = useTranslation();
  const { data: users } = useFetchUserListQuery();

  const owner = users?.filter(e => e.id === group.userId)[0];

  function getUserName() {
    if (!users) {
      return <Loader size={16} />;
    }
    let displayName = `${group.userId}`;
    if (owner && owner.last_name.length + owner.first_name.length > 0) {
      displayName = `${owner.first_name} ${owner.last_name}`;
    } else if (owner) {
      displayName = owner.username;
    }
    return displayName;
  }

  return (
    <div
      style={{
        paddingTop: 15,
        paddingBottom: 15,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, textAlign: "left" }}>
        <Avatar size={36} radius="xl" src={avatarSrc(owner)} />
        <div>
          <Text size="md" fw="bold" component="div">
            {getUserName()}
          </Text>
          <Text size="xs" c="dimmed" style={{ display: "flex", alignItems: "center" }}>
            <Polaroid size={16} style={{ marginRight: 5 }} />
            {isSharedToMe
              ? t("sharing.sharedPhotosWithYou", { count: group.photos.length })
              : t("sharing.youSharedPhotos", { count: group.photos.length })}
          </Text>
        </div>
      </div>
    </div>
  );
}

export function PhotosSharedByMe() {
  const { t } = useTranslation();
  // isLoading, not isFetching: a background refetch replaced every list with
  // the loader and lost the scroll position.
  const { data: photos = [], isLoading } = useFetchSharedPhotosByMeQuery();
  // The photo links listed above this panel (same query, no extra request).
  const { data: shares = [], isLoading: isLoadingShares } = useFetchPhotoSharesQuery();

  if (isLoading) {
    return (
      <Stack align="center" mt="xl">
        <Loader />
        <Text>{t("sharing.loadingPhotosSharedByYou")}</Text>
      </Stack>
    );
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
    <>
      {photos.map(group => (
        <PhotoListView
          key={group.userId}
          title={t("sidemenu.photos")}
          loading={false}
          icon={<Photo size={50} />}
          photoset={group.photos}
          idx2hash={group.photos}
          isPublic
          header={<GroupHeader group={group} isSharedToMe={false} />}
          selectable={false}
        />
      ))}
    </>
  );
}
