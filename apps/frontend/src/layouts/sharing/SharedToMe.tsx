import { Group, Stack, Tabs, Text, Title } from "@mantine/core";
import React, { useEffect } from "react";
import { useParams } from "react-router-dom";

import { fetchUserAlbumsSharedToMe } from "../../actions/albumsActions";
import { fetchPhotosSharedToMe } from "../../actions/photosActions";
import { fetchPublicUserList } from "../../actions/publicActions";
import { PhotosetType } from "../../reducers/photosReducer";
import { useAppDispatch, useAppSelector } from "../../store/store";
import { AlbumsShared } from "./AlbumsShared";
import { PhotosShared } from "./PhotosShared";

export function SharedToMe() {
  const dispatch = useAppDispatch();
  const { albums } = useAppSelector(store => store);
  const { photosFlat, photosGroupedByUser, fetchedPhotosetType } = useAppSelector(store => store.photos);
  const { which } = useParams();

  useEffect(() => {
    if (fetchedPhotosetType !== PhotosetType.SHARED_BY_ME) {
      dispatch(fetchPublicUserList());
      dispatch(fetchPhotosSharedToMe());
      dispatch(fetchUserAlbumsSharedToMe());
    }
  }, []);

  const getSubHeader = (item = "photos") => {
    if (item === "photos") {
      return (
        <Text color="dimmed">
          {photosGroupedByUser.length} user(s) shared {photosFlat.length} photo(s) with you
        </Text>
      );
    }
    return (
      <Text color="dimmed">
        {albums.albumsSharedToMe.length} user(s) shared{" "}
        {albums.albumsSharedToMe.length > 0 &&
          albums.albumsSharedToMe.map(el => el.albums.length).reduce((a, b) => a + b, 0)}{" "}
        album(s) with you
      </Text>
    );
  };

  return (
    <Stack>
      <Group>
        <div>
          <Title order={2}> {which === "photos" ? "Photos" : "Albums"} others shared </Title>
          <Text color="dimmed" size="sm">
            {getSubHeader(which)}
          </Text>
        </div>
      </Group>
      <Tabs defaultValue="photos">
        <Tabs.List>
          <Tabs.Tab value="photos">Photos</Tabs.Tab>
          <Tabs.Tab value="albums">Albums</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="photos">
          <PhotosShared isSharedToMe />
        </Tabs.Panel>

        <Tabs.Panel value="albums">
          <AlbumsShared isSharedToMe />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
