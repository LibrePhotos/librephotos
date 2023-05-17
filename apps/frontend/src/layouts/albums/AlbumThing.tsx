import React from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { AutoSizer, Grid } from "react-virtualized";
import { Tags } from "tabler-icons-react";

import { useFetchThingsAlbumsQuery } from "../../api_client/albums/things";
import { Tile } from "../../components/Tile";
import { useAlbumListGridConfig } from "../../hooks/useAlbumListGridConfig";
import { HeaderComponent } from "./HeaderComponent";

export function AlbumThing() {
  const { t } = useTranslation();
  const { data: albums, isFetching } = useFetchThingsAlbumsQuery();
  const { entriesPerRow, entrySquareSize, numberOfRows, gridHeight } = useAlbumListGridConfig(albums || []);

  function renderCell({ columnIndex, key, rowIndex, style }) {
    if (!albums || albums.length === 0) {
      return null;
    }
    const index = rowIndex * entriesPerRow + columnIndex;
    if (index >= albums.length) {
      return <div key={key} style={style} />;
    }
    return (
      <div key={key} style={style}>
        {albums[index].cover_photos.slice(0, 1).map(photo => (
          <Link key={albums[index].id} to={`/thing/${albums[index].id}/`}>
            <Tile
              video={photo.video === true}
              height={entrySquareSize - 10}
              width={entrySquareSize - 10}
              image_hash={photo.image_hash}
            />
          </Link>
        ))}
        <div style={{ paddingLeft: 15, paddingRight: 15, height: 50 }}>
          <b>{albums[index].title}</b>
          <br />
          {t("numberofphotos", {
            number: albums[index].photo_count,
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
            height={gridHeight}
            rowHeight={entrySquareSize + 60}
            rowCount={numberOfRows}
            width={containerWidth}
          />
        )}
      </AutoSizer>
    </div>
  );
}
