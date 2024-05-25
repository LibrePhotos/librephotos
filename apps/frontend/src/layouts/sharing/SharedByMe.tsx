import { Group, Stack, Tabs, Text, Title } from "@mantine/core";
import React from "react";
import { useNavigate, useParams } from "react-router-dom";

import { useFetchSharedAlbumsByMeQuery } from "../../api_client/albums/sharing";
import { useFetchSharedPhotosByMeQuery } from "../../api_client/photos/sharing";
import { AlbumsSharedByMe } from "../../components/sharing/AlbumsSharedByMe";
import { PhotosSharedByMe } from "../../components/sharing/PhotosSharedByMe";

export function SharedByMe() {
  const navigate = useNavigate();
  const { data: albums = [] } = useFetchSharedAlbumsByMeQuery();
  const { data: photos = [] } = useFetchSharedPhotosByMeQuery();
  const { which } = useParams();

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
          <Title order={2}> {which === "photos" ? "Photos" : "Albums"} you shared</Title>
          <Text c="dimmed" size="sm">
            {getSubHeader(which)}
          </Text>
        </div>
      </Group>
      <Tabs defaultValue={which} onChange={value => navigate(`/shared/fromme/${value}/`)}>
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
