import { createFileRoute } from '@tanstack/react-router'

import { Group, Stack, Tabs, Text, Title } from "@mantine/core";
import React from "react";
import { useNavigate } from  "@tanstack/react-router";

import { useFetchSharedAlbumsByMeQuery } from "../../../api_client/albums/hooks";
import { useFetchSharedPhotosByMeQuery } from "../../../api_client/photos/hooks";
import { AlbumsSharedByMe } from "../../../components/sharing/AlbumsSharedByMe";
import { PhotosSharedByMe } from "../../../components/sharing/PhotosSharedByMe";

export const Route = createFileRoute('/_protected/shared/fromme/$tab')({
  component: SharedByMe,
})


export function SharedByMe() {
  const navigate = useNavigate();
  const { data: albums = [] } = useFetchSharedAlbumsByMeQuery();
  const { data: photos = [] } = useFetchSharedPhotosByMeQuery();
  const { tab } = Route.useParams();

  const getSubHeader = (item = "photos") => {
    if (item === "photos") {
      return (
        <Text>
          {photos.length} photo share(s) with {photos.flatMap(g => g.userId).length} user(s)
        </Text>
      );
    }
    return <Text>You shared {albums.length} albums</Text>;
  };

  return (
    <Stack>
      <Group>
        <div>
          <Title order={2}> {tab === "photos" ? "Photos" : "Albums"} you shared</Title>
          <Text c="dimmed" size="sm">
            {getSubHeader(tab)}
          </Text>
        </div>
      </Group>
      <Tabs defaultValue={tab} onChange={value => navigate({ to: `/shared/fromme/${value}/` })}>
        <Tabs.List>
          <Tabs.Tab value="photos">Photos</Tabs.Tab>
          <Tabs.Tab value="albums">Albums</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="photos">
          <PhotosSharedByMe />
        </Tabs.Panel>

        <Tabs.Panel value="albums">
          <AlbumsSharedByMe />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
