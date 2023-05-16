import { useViewportSize } from "@mantine/hooks";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { AutoSizer, Grid } from "react-virtualized";
import { Tags } from "tabler-icons-react";

import { useFetchThingsAlbumsQuery } from "../../api_client/albums/things";
import { Tile } from "../../components/Tile";
import { LEFT_MENU_WIDTH, TOP_MENU_HEIGHT } from "../../ui-constants";
import { HeaderComponent } from "./HeaderComponent";

const SIDEBAR_WIDTH = LEFT_MENU_WIDTH;

function calculateGridValues(width: number): { columnWidth: number; squareSize: number } {
  let entries = 6;
  if (width < 600) {
    entries = 2;
  } else if (width < 800) {
    entries = 3;
  } else if (width < 1000) {
    entries = 4;
  } else if (width < 1200) {
    entries = 5;
  }
  const columnWidth = width - SIDEBAR_WIDTH - 5 - 5 - 15;
  return { columnWidth, squareSize: columnWidth / entries };
}

export function AlbumThing() {
  const { t } = useTranslation();
  const { width, height } = useViewportSize();
  const [entriesPerRow, setEntriesPerRow] = useState(0);
  const [entrySquareSize, setEntrySquareSize] = useState(200);
  const [numberOfRows, setNumberOfRows] = useState(0);
  const { data: albums, isFetching } = useFetchThingsAlbumsQuery();

  useEffect(() => {
    const { columnWidth, squareSize } = calculateGridValues(width);
    setEntriesPerRow(columnWidth / squareSize);
    setEntrySquareSize(squareSize);
  }, [width, height]);

  useEffect(() => {
    if (albums) {
      setNumberOfRows(Math.ceil(albums.length / 6));
    }
  }, [albums]);

  function renderCell({ columnIndex, key, rowIndex, style }) {
    if (!albums || albums.length === 0) {
      return null;
    }
    const albumThingIndex = rowIndex * entriesPerRow + columnIndex;
    if (albumThingIndex >= albums.length) {
      return <div key={key} style={style} />;
    }
    return (
      <div key={key} style={style}>
        {albums[albumThingIndex].cover_photos.slice(0, 1).map(photo => (
          <Link key={albums[albumThingIndex].id} to={`/thing/${albums[albumThingIndex].id}/`}>
            <Tile
              video={photo.video === true}
              height={entrySquareSize - 10}
              width={entrySquareSize - 10}
              image_hash={photo.image_hash}
            />
          </Link>
        ))}
        <div style={{ paddingLeft: 15, paddingRight: 15, height: 50 }}>
          <b>{albums[albumThingIndex].title}</b>
          <br />
          {t("numberofphotos", {
            number: albums[albumThingIndex].photo_count,
          })}
        </div>
      </div>
    );
  }

  return (
    <div>
      <HeaderComponent
        icon={<Tags size={50} />}
        title={t("things")}
        fetching={isFetching}
        subtitle={t("thingalbum.showingthings", {
          number: (albums && albums.length) || 0,
        })}
      />
      <AutoSizer disableHeight style={{ outline: "none", padding: 0, margin: 0 }}>
        {({ width: containerWidth }) => (
          <Grid
            style={{ outline: "none" }}
            disableHeader={false}
            cellRenderer={props => renderCell(props)}
            columnWidth={entrySquareSize}
            columnCount={entriesPerRow}
            height={height - TOP_MENU_HEIGHT - 60}
            rowHeight={entrySquareSize + 60}
            rowCount={numberOfRows}
            width={containerWidth}
          />
        )}
      </AutoSizer>
    </div>
  );
}
