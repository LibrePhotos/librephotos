import { ActionIcon, Button, Group, Image, Menu, Modal, Text } from "@mantine/core";
import { useViewportSize } from "@mantine/hooks";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import LazyLoad from "react-lazyload";
import { Link } from "react-router-dom";
import { AutoSizer, Grid } from "react-virtualized";
import { push } from "redux-first-history";
import { DotsVertical, Edit, SettingsAutomation, Trash } from "tabler-icons-react";

import { deleteAutoAlbum, fetchAutoAlbumsList } from "../../actions/albumsActions";
import { searchPhotos } from "../../actions/searchActions";
import { serverAddress } from "../../api_client/apiClient";
import { Tile } from "../../components/Tile";
import { useAppDispatch, useAppSelector } from "../../store/store";
import { LEFT_MENU_WIDTH, TOP_MENU_HEIGHT } from "../../ui-constants";
import { HeaderComponent } from "./HeaderComponent";

const SIDEBAR_WIDTH = LEFT_MENU_WIDTH;

export const AlbumAuto = () => {
  const { width, height } = useViewportSize();
  const [entrySquareSize, setEntrySquareSize] = useState(200);
  const [numEntrySquaresPerRow, setNumEntrySquaresPerRow] = useState(0);
  const dispatch = useAppDispatch();
  const { t } = useTranslation();
  const auth = useAppSelector(store => store.auth);

  const [openDeleteDialogState, setOpenDeleteDialogState] = useState(false);
  const [autoAlbumID, setAutoAlbumID] = useState("");
  const [autoAlbumTitle, setAutoAlbumTitle] = useState("");

  const { albumsAutoList, fetchingAlbumsAutoList, fetchedAlbumsAutoList } = useAppSelector(store => store.albums);
  useEffect(() => {
    if (albumsAutoList.length === 0) {
      dispatch(fetchAutoAlbumsList());
    }
  }, []);
  useEffect(() => {
    let numEntrySquaresPerRow = 6;
    if (window.innerWidth < 600) {
      numEntrySquaresPerRow = 2;
    } else if (window.innerWidth < 800) {
      numEntrySquaresPerRow = 3;
    } else if (window.innerWidth < 1000) {
      numEntrySquaresPerRow = 4;
    } else if (window.innerWidth < 1200) {
      numEntrySquaresPerRow = 5;
    }

    const columnWidth = window.innerWidth - SIDEBAR_WIDTH - 5 - 5 - 15;

    const entrySquareSize = columnWidth / numEntrySquaresPerRow;
    setEntrySquareSize(entrySquareSize);
    setNumEntrySquaresPerRow(numEntrySquaresPerRow);
  }, [width, height]);

  const openDeleteDialog = (personID, personName) => {
    setOpenDeleteDialogState(true);
    setAutoAlbumID(personID);
    setAutoAlbumTitle(personName);
  };

  const cellRenderer = ({ columnIndex, key, rowIndex, style }) => {
    const albumAutoIndex = rowIndex * numEntrySquaresPerRow + columnIndex;
    if (albumAutoIndex < albumsAutoList.length) {
      return (
        <div key={key} style={style}>
          <div onClick={() => {}} style={{ padding: 5 }}>
            <Link to={`/event/${albumsAutoList[albumAutoIndex].id}`}>
              <Tile
                video={albumsAutoList[albumAutoIndex].photos.video === true}
                height={entrySquareSize - 10}
                width={entrySquareSize - 10}
                image_hash={albumsAutoList[albumAutoIndex].photos.image_hash}
              />
            </Link>
            <Menu
              style={{ position: "absolute", top: 10, right: 10 }}
              control={
                <ActionIcon>
                  <DotsVertical />
                </ActionIcon>
              }
            >
              <Menu.Item
                icon={<Trash />}
                onClick={() => {
                  openDeleteDialog(albumsAutoList[albumAutoIndex].id, albumsAutoList[albumAutoIndex].title);
                }}
              >
                {t("delete")}
              </Menu.Item>
            </Menu>
          </div>
          <div className="personCardName" style={{ paddingLeft: 15, paddingRight: 15, height: 50 }}>
            <b>{albumsAutoList[albumAutoIndex].title}</b> <br />
            {t("numberofphotos", {
              number: albumsAutoList[albumAutoIndex].photo_count,
            })}
          </div>
        </div>
      );
    }
    return <div key={key} style={style} />;
  };

  return (
    <div>
      <HeaderComponent
        icon={<SettingsAutomation size={50} />}
        title={t("events")}
        fetching={fetchingAlbumsAutoList}
        subtitle={t("autoalbum.subtitle", {
          autoalbumlength: albumsAutoList.length,
        })}
      />

      <AutoSizer disableHeight style={{ outline: "none", padding: 0, margin: 0 }}>
        {({ width }) => (
          <Grid
            style={{ outline: "none" }}
            disableHeader={false}
            cellRenderer={cellRenderer}
            columnWidth={entrySquareSize}
            columnCount={numEntrySquaresPerRow}
            height={height - TOP_MENU_HEIGHT - 60}
            rowHeight={entrySquareSize + 120}
            // @ts-ignore
            rowCount={Math.ceil(albumsAutoList.length / numEntrySquaresPerRow.toFixed(1))}
            width={width}
          />
        )}
      </AutoSizer>
      {
        //To-Do: Add Locale
      }
      <Modal opened={openDeleteDialogState} title="Delete Auto Album" onClose={() => setOpenDeleteDialogState(false)}>
        <Text size="sm">Do you really want to delete this auto album?</Text>
        <Group>
          <Button
            onClick={() => {
              setOpenDeleteDialogState(false);
            }}
          >
            {t("cancel")}
          </Button>
          <Button
            color="red"
            onClick={() => {
              dispatch(deleteAutoAlbum(autoAlbumID, autoAlbumTitle));
              setOpenDeleteDialogState(false);
            }}
          >
            {t("delete")}
          </Button>
        </Group>
      </Modal>
    </div>
  );
};

type Props = {
  size: number;
  cover_photos: any;
  title: string;
  photoCount: number;
};

export const EntrySquare = (props: Props) => {
  const dispatch = useAppDispatch();

  const { size, cover_photos, title, photoCount } = props;

  const images = cover_photos.map(photo => (
    <Image
      style={{ display: "inline-block", objectFit: "cover" }}
      width={size / 2 - 20}
      height={size / 2 - 20}
      src={`${serverAddress}/media/square_thumbnails/${photo.image_hash}`}
    />
  ));
  return (
    <div
      style={{
        width: size,
        display: "inline-block",
        paddingLeft: 10,
        paddingRight: 10,
      }}
      onClick={() => {
        dispatch(searchPhotos(title));
        dispatch(push("/search"));
      }}
    >
      <div style={{ height: size }}>
        <LazyLoad once unmountIfInvisible height={size}>
          <Group>{images}</Group>
        </LazyLoad>
      </div>
      <div style={{ height: 100 }}>
        <b>{title}</b> ({photoCount})
      </div>
    </div>
  );
};
