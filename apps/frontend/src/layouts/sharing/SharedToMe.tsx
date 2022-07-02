import { Group, Stack, Tabs, Text, Title } from "@mantine/core";
import React, { useEffect, useState } from "react";

import { fetchUserAlbumsSharedToMe } from "../../actions/albumsActions";
import { fetchPhotosSharedToMe } from "../../actions/photosActions";
import { fetchPublicUserList } from "../../actions/publicActions";
import { PhotosetType } from "../../reducers/photosReducer";
import { useAppDispatch, useAppSelector } from "../../store/store";
import { AlbumsShared } from "./AlbumsShared";
import { PhotosShared } from "./PhotosShared";

type Props = {
  match: any;
};

export const SharedToMe = (props: Props) => {
  const dispatch = useAppDispatch();
  const { albums } = useAppSelector(store => store);
  const { photosFlat, photosGroupedByUser, fetchedPhotosetType } = useAppSelector(store => store.photos);
  const { match } = props;
  const [activeTab, setActiveTab] = useState(1);

  useEffect(() => {
    if (fetchedPhotosetType !== PhotosetType.SHARED_BY_ME) {
      dispatch(fetchPublicUserList());
      dispatch(fetchPhotosSharedToMe());
      dispatch(fetchUserAlbumsSharedToMe());
    }
  }, []);

  const getSubHeader = activeItem => {
    if (activeItem === "photos") {
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
  const activeItem = match.params.which;

  return (
    <Stack>
      <Group>
        <div>
          <Title order={2}> {activeItem === "photos" ? "Photos" : "Albums"} others shared </Title>
          <Text color="dimmed" size="sm">
            {getSubHeader(activeItem)}
          </Text>
        </div>
      </Group>
      <Tabs active={activeTab} onTabChange={setActiveTab}>
        <Tabs.Tab label="Photos" name="photos">
          <PhotosShared isSharedToMe />
        </Tabs.Tab>
        <Tabs.Tab label="Albums" name="albums">
          <AlbumsShared isSharedToMe />
        </Tabs.Tab>
      </Tabs>
    </Stack>
  );
};
