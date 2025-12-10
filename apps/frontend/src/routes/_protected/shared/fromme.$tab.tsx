import { Group, Stack, Tabs, Text, Title } from "@mantine/core";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import React from "react";
import { useFetchSharedAlbumsByMeQuery } from "../../../api_client/albums/hooks";
import { useFetchSharedPhotosByMeQuery } from "../../../api_client/photos/hooks";
import { AlbumsSharedByMe } from "../../../components/sharing/AlbumsSharedByMe";
import { PhotosSharedByMe } from "../../../components/sharing/PhotosSharedByMe";

export const Route = createFileRoute("/_protected/shared/fromme/$tab")();

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
    // albums is grouped by recipient, so we need to count total unique albums
    const totalAlbums = new Set(albums.flatMap(g => g.albums.map(a => a.id))).size;
    return <Text>You shared {totalAlbums} album(s)</Text>;
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

        <Tabs.Panel value="photos" keepMounted={false}>
          <PhotosSharedByMe />
        </Tabs.Panel>

        <Tabs.Panel value="albums" keepMounted={false}>
          <AlbumsSharedByMe />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

Route.update({ component: SharedByMe });
