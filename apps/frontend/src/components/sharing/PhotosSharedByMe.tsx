import { Loader, Stack, Text } from "@mantine/core";
import { IconPhoto as Photo, IconPolaroid as Polaroid, IconUser as User } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useFetchSharedPhotosByMeQuery } from "../../api_client/photos/hooks";
import { useFetchUserListQuery } from "../../api_client/user/hooks";
import { PhotoListView } from "../photolist/PhotoListView";

type GroupHeaderProps = {
  group: {
    userId: number;
    photos: any[];
  };
  isSharedToMe: boolean;
};

function GroupHeader({ group, isSharedToMe }: Readonly<GroupHeaderProps>) {
  const { t } = useTranslation();
  const { data: users } = useFetchUserListQuery();

  function getUserName(userId: number) {
    if (!users) {
      return <Loader size={16} />;
    }
    const owner = users.filter(e => e.id === userId)[0];
    let displayName = `${group.userId}`;
    if (owner && owner.last_name.length + owner.first_name.length > 0) {
      displayName = `${owner.first_name} ${owner.last_name}`;
    } else if (owner) {
      displayName = owner.username;
    }
    return <Text>{displayName}</Text>;
  }

  return (
    <div
      style={{
        paddingTop: 15,
        paddingBottom: 15,
      }}
    >
      <div style={{ display: "flex", textAlign: "left" }}>
        <User size={36} style={{ margin: 5 }} />
        <div>
          <Text size="md" fw="bold">
            {getUserName(group.userId)}
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
  const { data: photos = [], isFetching } = useFetchSharedPhotosByMeQuery();

  if (isFetching) {
    return (
      <Stack align="center">
        <Loader />
        <Text>{t("sharing.loadingPhotosSharedByYou")}</Text>
      </Stack>
    );
  }

  return (
    <>
      {photos.map(group => (
        <PhotoListView
          key={group.userId}
          title={t("sidemenu.photos")}
          loading={isFetching}
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
