import { Flex, Group, Text } from "@mantine/core";
import { IconTags as Tags } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { AutoSizer, Grid } from "react-virtualized";

import { useFetchThingsAlbumsQuery } from "../../api_client/albums/things-tanstack";
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
    const album = albums[index];
    return (
      <div key={key} style={style}>
        <div style={{ padding: 5 }}>
          {album.cover_photos.slice(0, 1).map(photo => (
            <Link key={album.id} to={`/thing/${album.id}/`}>
              <Tile
                video={photo.video === true}
                height={entrySquareSize - 10}
                width={entrySquareSize - 10}
                image_hash={photo.image_hash}
              />
            </Link>
          ))}
        </div>
        <Group justify="apart">
          <Flex gap={0} justify="left" direction="column" px={8}>
            <Text size="sm" fw={500} lineClamp={1} title={album.title}>
              {album.title}
            </Text>
            <Text size="xs">{t("numberofphotos", { number: album.photo_count })}</Text>
          </Flex>
        </Group>
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
