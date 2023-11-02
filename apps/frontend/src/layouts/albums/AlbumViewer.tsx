import { Button, Group, Stack, Title } from "@mantine/core";
import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { push } from "redux-first-history";
import { Album } from "tabler-icons-react";

import { fetchAutoAlbumsList, fetchUserAlbumsList } from "../../actions/albumsActions";
import { Tile } from "../../components/Tile";
import { useAppDispatch, useAppSelector } from "../../store/store";
import { HeaderComponent } from "./HeaderComponent";

export function AlbumViewer() {
  const { albumsAutoList, fetchingAlbumsAutoList, albumsUserList } = useAppSelector(store => store.albums);
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
        icon={<Album size={50} />}
        fetching={fetchingAlbumsAutoList || fetchingAlbumsAutoList}
        title="Albums"
        subtitle="Explore your photos."
      />

      <Group position="apart">
        <Title order={3}>{t("myalbums")}</Title>
        <Button variant="subtle" component={Link} to="/useralbums/">
          View all
        </Button>
      </Group>
      <Group>
        {albumsUserList.slice(0, 19).map(autoAlbum => (
          <Tile
            onClick={() => {
              dispatch(push(`/album/${autoAlbum.id}`));
            }}
            video={autoAlbum.cover_photos[0].video === true}
            height={entrySquareSize - 10}
            width={entrySquareSize - 10}
            image_hash={autoAlbum.cover_photos[0].image_hash}
          />
        ))}
      </Group>

      <Group position="apart">
        <Title order={3}>{t("events")}</Title>
        <Button variant="subtle" component={Link} to="/events/">
          View all
        </Button>
      </Group>
      <Group>
        {albumsAutoList.slice(0, 19).map(autoAlbum => (
          <Tile
            onClick={() => {
              dispatch(push(`/album/${autoAlbum.id}`));
            }}
            video={autoAlbum.photos.video === true}
            height={entrySquareSize - 10}
            width={entrySquareSize - 10}
            image_hash={autoAlbum.photos.image_hash}
          />
        ))}
      </Group>
    </Stack>
  );
}
