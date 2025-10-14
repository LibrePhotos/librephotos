import { Group, Stack, Tabs, Text, Title } from "@mantine/core";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import React from "react";
import { useFetchSharedAlbumsWithMeQuery } from "../../../api_client/albums/hooks";
import { useFetchSharedPhotosWithMeQuery } from "../../../api_client/photos/hooks";
import { AlbumsSharedWithMe } from "../../../components/sharing/AlbumsSharedWithMe";
import { PhotosSharedWithMe } from "../../../components/sharing/PhotosSharedWithMe";

export const Route = createFileRoute("/_protected/shared/tome/$tab")();

export function SharedWithMe() {
  const navigate = useNavigate();
  const { data: albums = [] } = useFetchSharedAlbumsWithMeQuery();
  const { data: photos = [] } = useFetchSharedPhotosWithMeQuery();
  const { tab } = Route.useParams();

  const getSubHeader = (item = "photos") => {
    if (item === "photos") {
      return (
        <Text c="dimmed">
          {photos.flatMap(g => g.userId).length} user(s) shared {photos.length} photo(s) with you
        </Text>
      );
    }
    return (
      <Text c="dimmed">
        {albums.length} user(s) shared {albums.map(el => el.albums.length).reduce((a, b) => a + b, 0)} album(s) with you
      </Text>
    );
  };

  return (
    <Stack>
      <Group>
        <div>
          <Title order={2}> {tab === "photos" ? "Photos" : "Albums"} others shared </Title>
          <Text c="dimmed" size="sm">
            {getSubHeader(tab)}
          </Text>
        </div>
      </Group>
      <Tabs defaultValue={tab} onChange={value => navigate({ to: `/shared/tome/${value}/` })}>
        <Tabs.List>
          <Tabs.Tab value="photos">Photos</Tabs.Tab>
          <Tabs.Tab value="albums">Albums</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="photos">
          <PhotosSharedWithMe />
        </Tabs.Panel>

        <Tabs.Panel value="albums">
          <AlbumsSharedWithMe />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

Route.update({ component: SharedWithMe });
