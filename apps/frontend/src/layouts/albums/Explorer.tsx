import { Box, Button, Group, Stack, Title } from "@mantine/core";
import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { push } from "redux-first-history";
import { Ballon } from "tabler-icons-react";

import { fetchAutoAlbumsList, fetchUserAlbumsList } from "../../actions/albumsActions";
import { Tile } from "../../components/Tile";
import { useAppDispatch, useAppSelector } from "../../store/store";
import { HeaderComponent } from "./HeaderComponent";

export function Explorer() {
  const { albumsAutoList, fetchingAlbumsAutoList } = useAppSelector(store => store.albums);
  const dispatch = useAppDispatch();
  const { t } = useTranslation();
  const entrySquareSize = 200;

  useEffect(() => {
    dispatch(fetchAutoAlbumsList());
    dispatch(fetchUserAlbumsList());
  }, []);

  function getAutoAlbums(albums) {
    return albums.slice(0, 19).map(album => (
      <Tile
        onClick={() => {
          dispatch(push(`/album/${album.id}`));
        }}
        key={album.id}
        video={album.cover_photos[0].video === true}
        height={entrySquareSize - 10}
        width={entrySquareSize - 10}
        image_hash={album.cover_photos[0].image_hash}
      />
    ));
  }

  return (
    <Stack>
      <HeaderComponent
        icon={<Ballon size={50} />}
        fetching={fetchingAlbumsAutoList}
        title="Explorer"
        subtitle="Explore your photos."
      />
      <Title order={3}>{t("people")}</Title>
      <Group>
        {getAutoAlbums(albumsAutoList)}
        <Box color="gray">
          <Button
            variant="light"
            color="gray"
            onClick={() => {
              dispatch(push(`/album/`));
            }}
          >
            Show More
          </Button>
        </Box>
      </Group>
      <Title order={3}>{t("things")}</Title>
      <Group>
        {getAutoAlbums(albumsAutoList)}
        <Box color="gray">
          <Button
            variant="light"
            color="gray"
            onClick={() => {
              dispatch(push(`/album/`));
            }}
          >
            Show More
          </Button>
        </Box>
      </Group>
      <Title order={3}>{t("places")}</Title>
      <Group>
        {getAutoAlbums(albumsAutoList)}
        <Box color="gray">
          <Button
            variant="light"
            color="gray"
            onClick={() => {
              dispatch(push(`/album/`));
            }}
          >
            Show More
          </Button>
        </Box>
      </Group>
    </Stack>
  );
}
