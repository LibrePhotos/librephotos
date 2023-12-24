import { Loader, Stack, Text } from "@mantine/core";
import { IconPhoto as Photo, IconPolaroid as Polaroid, IconUser as User } from "@tabler/icons-react";
import React from "react";

import { useFetchUserListQuery } from "../../api_client/api";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { PhotosetType } from "../../reducers/photosReducer";
import { useAppSelector } from "../../store/store";

type GroupHeaderProps = {
  group: {
    userId: number;
    photos: any[];
  };
  isSharedToMe: boolean;
};

function GroupHeader({ group, isSharedToMe }: Readonly<GroupHeaderProps>) {
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
          <Text size="md" weight="bold">
            {getUserName(group.userId)}
          </Text>
          <Text size="xs" color="dimmed" style={{ display: "flex", alignItems: "center" }}>
            <Polaroid size={16} style={{ marginRight: 5 }} />
            {isSharedToMe
              ? `shared ${group.photos.length} photos with you`
              : `you shared ${group.photos.length} photos`}
          </Text>
        </div>
      </div>
    </div>
  );
}

type PhotosSharedProps = {
  isSharedToMe: boolean;
};

export function PhotosShared({ isSharedToMe }: Readonly<PhotosSharedProps>) {
  const type = isSharedToMe ? PhotosetType.SHARED_TO_ME : PhotosetType.SHARED_BY_ME;
  const loadingText = isSharedToMe ? "Loading photos shared with you..." : "Loading photos shared by you...";
  const { photosGroupedByUser, fetchedPhotosetType } = useAppSelector(state => state.photos);

  return (
    <div>
      {fetchedPhotosetType !== type ? (
        <Stack align="center">
          <Loader />
          {loadingText}
        </Stack>
      ) : (
        photosGroupedByUser.map(group => (
          <PhotoListView
            key={group.key}
            title="Photos"
            loading={fetchedPhotosetType !== type}
            icon={<Photo size={50} />}
            photoset={group.photos}
            idx2hash={group.photos}
            isPublic
            header={<GroupHeader group={group} isSharedToMe={isSharedToMe} />}
            selectable={false}
          />
        ))
      )}
    </div>
  );
}
