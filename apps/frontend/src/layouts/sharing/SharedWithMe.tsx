import { Group, Stack, Tabs, Text, Title } from "@mantine/core";
import React from "react";
import { useNavigate, useParams } from "react-router-dom";

import { useFetchSharedAlbumsWithMeQuery } from "../../api_client/albums/sharing";
import { useFetchSharedPhotosWithMeQuery } from "../../api_client/photos/sharing";
import { AlbumsSharedWithMe } from "../../components/sharing/AlbumsSharedWithMe";
import { PhotosSharedWithMe } from "../../components/sharing/PhotosSharedWithMe";

export function SharedWithMe() {
  const navigate = useNavigate();
  const { data: albums = [] } = useFetchSharedAlbumsWithMeQuery();
  const { data: photos = [] } = useFetchSharedPhotosWithMeQuery();
  const { which } = useParams();

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
          <Title order={2}> {which === "photos" ? "Photos" : "Albums"} others shared </Title>
          <Text c="dimmed" size="sm">
            {getSubHeader(which)}
          </Text>
        </div>
      </Group>
      <Tabs defaultValue={which} onChange={value => navigate(`/shared/tome/${value}/`)}>
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
