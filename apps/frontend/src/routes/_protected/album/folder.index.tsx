import { createFileRoute } from '@tanstack/react-router';

import { Group, Text } from "@mantine/core";
import { IconFolder as Folder } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { AutoSizer, Grid } from "react-virtualized";

import { useFetchFolderSubfoldersQuery, type SubfolderInfo } from "../../../api_client/albums/hooks";
import { useAlbumListGridConfig } from "../../../hooks/useAlbumListGridConfig";
import { HeaderComponent } from "../../../components/HeaderComponent";

export const Route = createFileRoute('/_protected/album/folder/')({
  component: AlbumFolder,
});



export function AlbumFolder() {
  const { t } = useTranslation();
  const { data: folderData, isFetching } = useFetchFolderSubfoldersQuery();
  const subfolders = folderData?.subfolders ?? [];
  const { entriesPerRow, entrySquareSize, numberOfRows, gridHeight } = useAlbumListGridConfig(subfolders);

  function renderCell({ columnIndex, key, rowIndex, style }) {
    if (!subfolders || subfolders.length === 0) {
      // Show a message when there are no subfolders
      if (columnIndex === 0 && rowIndex === 0) {
        return (
          <div key={key} style={{ ...style, gridColumn: '1 / -1', textAlign: 'center', padding: '50px' }}>
            <Folder size={64} style={{ color: '#ccc', marginBottom: '16px' }} />
            <Text size="lg" c="dimmed">
              {t("no_folders", { defaultValue: "No folders with photos found" })}
            </Text>
            <Text size="sm" c="dimmed" mt="xs">
              {t("upload_photos_hint", { defaultValue: "Upload some photos to see your folder structure!" })}
            </Text>
          </div>
        );
      }
      return <div key={key} style={style} />;
    }

    const index = rowIndex * entriesPerRow + columnIndex;
    if (index >= subfolders.length) {
      return <div key={key} style={style} />;
    }

    const subfolder = subfolders[index];
    return (
      <div key={key} style={style}>
        <div style={{ padding: 5, height: entrySquareSize, width: entrySquareSize }}>
          <Link to="/album/folder/$id" params={{ id: encodeURIComponent(subfolder.path) }}>
            <div
              style={{
                width: entrySquareSize - 10,
                height: entrySquareSize - 10,
                backgroundColor: '#f0f0f0',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '2px solid #ddd',
                transition: 'all 0.2s ease',
                cursor: 'pointer'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#e8f4f8';
                e.currentTarget.style.borderColor = '#228be6';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#f0f0f0';
                e.currentTarget.style.borderColor = '#ddd';
              }}
            >
              <Folder size={40} style={{ color: '#666' }} />
            </div>
          </Link>
        </div>
        <div style={{ paddingLeft: 15, paddingRight: 15, height: 50 }}>
          <Group justify="center">
            <Text fw="bold" lineClamp={1} ta="center" size="sm">
              {subfolder.name}
            </Text>
          </Group>
          <Text size="xs" c="dimmed" ta="center" mt="xs">
            {t("photo_count", { defaultValue: "{{count}} photos", count: subfolder.photo_count })}
          </Text>
        </div>
      </div>
    );
  }

  return (
    <div>
      <HeaderComponent
        icon={<Folder size={50} />}
        title={t("folders", { defaultValue: "Folders" })}
        fetching={isFetching}
        subtitle={t("folders_count", {
          defaultValue: "{{count}} folders with photos",
          count: subfolders.length,
        })}
      />


      <AutoSizer disableHeight style={{ outline: "none", padding: 0, margin: 0 }}>
        {({ width }) => (
          <Grid
            style={{ outline: "none" }}
            disableTitle={false}
            cellRenderer={props => renderCell(props)}
            columnWidth={entrySquareSize}
            columnCount={entriesPerRow}
            height={gridHeight}
            rowHeight={entrySquareSize + 60}
            rowCount={numberOfRows}
            width={width}
          />
        )}
      </AutoSizer>
    </div>
  );
}