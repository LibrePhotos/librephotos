import { Box, Button, Group, Loader, Stack, Title } from "@mantine/core";
import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { push } from "redux-first-history";
import { Ballon } from "tabler-icons-react";

import { fetchAutoAlbumsList, fetchUserAlbumsList } from "../../actions/albumsActions";
import { Tile } from "../../components/Tile";
import { useAppDispatch, useAppSelector } from "../../store/store";
import { HeaderComponent } from "./HeaderComponent";

export const Explorer = () => {
  const auth = useAppSelector(state => state.auth);
  const { albumsAutoList, fetchingAlbumsAutoList, albumsUserList, fetchingAlbumsUserList } = useAppSelector(
    store => store.albums
  );
  const dispatch = useAppDispatch();
  const { t } = useTranslation();
  const entrySquareSize = 200;

  useEffect(() => {
    dispatch(fetchAutoAlbumsList());
    dispatch(fetchUserAlbumsList());
  }, []);

  return (
    <Stack>
      <HeaderComponent
        icon={<Ballon size={50} />}
        fetching={fetchingAlbumsAutoList || fetchingAlbumsAutoList}
        title="Explorer"
        subtitle="Explore your photos."
      />
      <Title order={3}>{t("people")}</Title>
      <Group>
        {albumsUserList.slice(0, 19).map(autoAlbum => {
          return (
            <Tile
              onClick={() => {
                dispatch(push(`/album/${autoAlbum.id}`));
              }}
              video={autoAlbum.cover_photos[0].video === true}
              height={entrySquareSize - 10}
              width={entrySquareSize - 10}
              image_hash={autoAlbum.cover_photos[0].image_hash}
            />
          );
        })}

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
        {albumsUserList.slice(0, 19).map(autoAlbum => {
          return (
            <Tile
              onClick={() => {
                dispatch(push(`/album/${autoAlbum.id}`));
              }}
              video={autoAlbum.cover_photos[0].video === true}
              height={entrySquareSize - 10}
              width={entrySquareSize - 10}
              image_hash={autoAlbum.cover_photos[0].image_hash}
            />
          );
        })}
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
        {albumsUserList.slice(0, 19).map(autoAlbum => {
          return (
            <Tile
              onClick={() => {
                dispatch(push(`/album/${autoAlbum.id}`));
              }}
              video={autoAlbum.cover_photos[0].video === true}
              height={entrySquareSize - 10}
              width={entrySquareSize - 10}
              image_hash={autoAlbum.cover_photos[0].image_hash}
            />
          );
        })}
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
};
