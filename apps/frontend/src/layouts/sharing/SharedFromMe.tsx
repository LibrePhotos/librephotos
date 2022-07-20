import { Group, Stack, Tabs, Text, Title } from "@mantine/core";
import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { fetchUserAlbumsSharedFromMe } from "../../actions/albumsActions";
import { fetchPhotosSharedFromMe } from "../../actions/photosActions";
import { fetchPublicUserList } from "../../actions/publicActions";
import { PhotosetType } from "../../reducers/photosReducer";
import { useAppDispatch, useAppSelector } from "../../store/store";
import { AlbumsShared } from "./AlbumsShared";
import { PhotosShared } from "./PhotosShared";

export function SharedFromMe() {
  const dispatch = useAppDispatch();
  const { albums } = useAppSelector(store => store);
  const { photosFlat, photosGroupedByUser, fetchedPhotosetType } = useAppSelector(store => store.photos);
  const { which } = useParams();
  const [activeTab, setActiveTab] = useState(1);

  useEffect(() => {
    if (fetchedPhotosetType !== PhotosetType.SHARED_BY_ME) {
      dispatch(fetchPublicUserList());
      dispatch(fetchPhotosSharedFromMe());
      dispatch(fetchUserAlbumsSharedFromMe());
    }
  }, [dispatch, fetchedPhotosetType]);

  const getSubHeader = activeItem => {
    if (activeItem === "photos") {
      return (
        <Text color="dimmed">
          {photosFlat.length} photo share(s) with {photosGroupedByUser.length} user(s)
        </Text>
      );
    }
    return <Text color="dimmed">You shared {albums.albumsSharedFromMe.length} albums</Text>;
  };

  const activeItem = which;

  return (
    <Stack>
      <Group>
        <div>
          <Title order={2}> {activeItem === "photos" ? "Photos" : "Albums"} you shared</Title>
          <Text color="dimmed" size="sm">
            {getSubHeader(activeItem)}
          </Text>
        </div>
      </Group>
      <Tabs active={activeTab} onTabChange={setActiveTab}>
        <Tabs.Tab label="Photos" name="photos">
          <PhotosShared isSharedToMe={false} />
        </Tabs.Tab>
        <Tabs.Tab label="Albums" name="albums">
          <AlbumsShared isSharedToMe={false} />
        </Tabs.Tab>
      </Tabs>
    </Stack>
  );
}
