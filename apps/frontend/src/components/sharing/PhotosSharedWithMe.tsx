import { Loader, Stack, Text } from "@mantine/core";
import { IconPhoto as Photo, IconPolaroid as Polaroid, IconUser as User } from "@tabler/icons-react";
import React from "react";

import { useFetchUserListQuery } from "../../api_client/api";
import { useFetchSharedPhotosWithMeQuery } from "../../api_client/photos/sharing";
import { PhotoListView } from "../photolist/PhotoListView";

type GroupHeaderProps = {
  group: {
    userId: number;
    photos: any[];
  };
};

function GroupHeader({ group }: Readonly<GroupHeaderProps>) {
  const { data: users } = useFetchUserListQuery();

  function getUserName(userId: number) {
    if (!users) {
      return <Loader size={16} />;
    }
    const owner = users.filter(e => e.id === userId)[0];
    let displayName = `user(${group.userId})`;
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
            {`shared ${group.photos.length} photos with you`}
          </Text>
        </div>
      </div>
    </div>
  );
}

export function PhotosSharedWithMe() {
  const { data: photos = [], isFetching } = useFetchSharedPhotosWithMeQuery();

  if (isFetching) {
    return (
      <Stack align="center">
        <Loader />
        <Text>Loading photos shared with you...</Text>
      </Stack>
    );
  }

  return (
    <>
      {photos.map(group => (
        <PhotoListView
          key={group.userId}
          title="Photos"
          loading={isFetching}
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
