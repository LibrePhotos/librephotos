import { Avatar, Loader, Stack, Text } from "@mantine/core";
import { IconPhoto as Photo, IconPolaroid as Polaroid } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useFetchSharedPhotosWithMeQuery } from "../../api_client/photos/hooks";
import { useFetchUserListQuery } from "../../api_client/user/hooks";
import { PhotoListView } from "../photolist/PhotoListView";
import { avatarSrc } from "./avatarSrc";

type GroupHeaderProps = {
  group: {
    userId: number;
    photos: any[];
  };
};

function GroupHeader({ group }: Readonly<GroupHeaderProps>) {
  const { t } = useTranslation();
  const { data: users } = useFetchUserListQuery();

  const owner = users?.filter(e => e.id === group.userId)[0];

  function getUserName() {
    if (!users) {
      return <Loader size={16} />;
    }
    let displayName = `user(${group.userId})`;
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
            {t("sharing.sharedPhotosWithYou", { count: group.photos.length })}
          </Text>
        </div>
      </div>
    </div>
  );
}

export function PhotosSharedWithMe() {
  const { t } = useTranslation();
  // isLoading, not isFetching: a background refetch replaced every list with
  // the loader and lost the scroll position.
  const { data: photos = [], isLoading } = useFetchSharedPhotosWithMeQuery();

  if (isLoading) {
    return (
      <Stack align="center" mt="xl">
        <Loader />
        <Text>{t("sharing.loadingPhotosSharedWithYou")}</Text>
      </Stack>
    );
  }

  if (photos.length === 0) {
    return (
      <Stack align="center" mt="xl">
        <Text c="dimmed">{t("sharing.noPhotosSharedWithYou")}</Text>
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
          header={<GroupHeader group={group} />}
          selectable={false}
        />
      ))}
    </>
  );
}
