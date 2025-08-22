import { createFileRoute } from '@tanstack/react-router';

import { Group, Button, Box } from "@mantine/core";
import { IconFolder as Folder, IconArrowLeft } from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMediaQuery } from "@mantine/hooks";

import { PigPhoto } from "../../../api_client/photos/types";
import { useFetchDateAlbumsQuery, useFetchDateAlbumQuery } from "../../../api_client/albums/hooks";
import { PhotoListView, PhotoGroup } from "../../../components/photolist/PhotoListView";
import { Photoset } from "../../../api_client/photos/types";
import { getPhotosFlatFromGroupedByDate } from "../../../util/util";
import { useFetchFolderSubfoldersQuery } from "../../../api_client/albums/hooks";

export const Route = createFileRoute('/_protected/album/folder/$id')({
  component: FolderDetail,
});

export function FolderDetail() {
  const { id } = Route.useParams();
  const folderPath = decodeURIComponent(id); // The id is the encoded folder path
  const { t } = useTranslation();
  const [photosFlat, setPhotosFlat] = useState<PigPhoto[]>([]);

  // Responsive breakpoints
  const isMobile = useMediaQuery('(max-width: 768px)');
  const isSmallMobile = useMediaQuery('(max-width: 480px)');

  // Get photos from this folder using FOLDERS photoset
  const { data: photosGroupedByDate, isLoading } = useFetchDateAlbumsQuery({
    photosetType: Photoset.NONE,
    folder: folderPath,
  });

  // Get subfolders for navigation
  const { data: folderData } = useFetchFolderSubfoldersQuery(folderPath);

  useEffect(() => {
    if (photosGroupedByDate) {
      setPhotosFlat(getPhotosFlatFromGroupedByDate(photosGroupedByDate));
    }
  }, [photosGroupedByDate]);

  const [group, setGroup] = useState({} as PhotoGroup);

  console.log(photosGroupedByDate);

  useFetchDateAlbumQuery(
    { album_date_id: group.id, page: group.page, photosetType: Photoset.NONE, folder: folderPath },
    { skip: !group.id }
  );

  const getAlbums = (visibleGroups: any) => {
    visibleGroups.reverse().forEach((photoGroup: any) => {
      const visibleImages = photoGroup.items;
      if (visibleImages.filter((i: any) => i.isTemp).length > 0) {
        const firstTempObject = visibleImages.filter((i: any) => i.isTemp)[0];
        const page = Math.ceil((parseInt(firstTempObject.id, 10) + 1) / 100);

        setGroup({ id: photoGroup.id, page });
      }
    });
  };

  function getSubheader() {
    const subfolders = folderData?.subfolders || [];
    const parentPath = folderPath.substring(0, folderPath.lastIndexOf('/'));
    const canGoBack = parentPath && parentPath !== folderPath && parentPath.length > 0;

    // Responsive settings
    const maxFolders = isSmallMobile ? 3 : isMobile ? 4 : 6;
    const buttonSize = isMobile ? "sm" : "xs";
    const iconSize = isMobile ? 16 : 14;
    const maxFolderNameLength = isSmallMobile ? 12 : isMobile ? 15 : 20;

    // Truncate folder names for mobile
    const truncateFolderName = (name: string) => {
      if (name.length <= maxFolderNameLength) return name;
      return name.substring(0, maxFolderNameLength - 3) + '...';
    };

    return (
      <Box style={{ marginTop: isMobile ? '12px' : '16px', marginBottom: isMobile ? '12px' : '16px' }}>
        <Group
          gap={isSmallMobile ? "xs" : "sm"}
          style={{
            flexWrap: 'wrap',
            alignItems: 'center'
          }}
        >
          {/* Back button */}
          {canGoBack ? (
            <Button
              variant="subtle"
              size={buttonSize}
              leftSection={<IconArrowLeft size={iconSize} />}
              onClick={() => {
                window.location.href = `/album/folder/${encodeURIComponent(parentPath)}`;
              }}
              styles={{
                root: {
                  minHeight: isMobile ? '32px' : '28px',
                  padding: isMobile ? '4px 8px' : '2px 6px'
                }
              }}
            >
              {isSmallMobile ?
                t("back", { defaultValue: "Back" }) :
                t("back_to_parent", { defaultValue: "Back to Parent" })
              }
            </Button>
          ) : (
            <Button
              variant="subtle"
              size={buttonSize}
              leftSection={<IconArrowLeft size={iconSize} />}
              onClick={() => {
                window.location.href = '/album/folder';
              }}
              styles={{
                root: {
                  minHeight: isMobile ? '32px' : '28px',
                  padding: isMobile ? '4px 8px' : '2px 6px'
                }
              }}
            >
              {isSmallMobile ?
                t("folders", { defaultValue: "Folders" }) :
                t("back_to_folders", { defaultValue: "Back to Folders" })
              }
            </Button>
          )}

          {/* Folder buttons */}
          {subfolders.slice(0, maxFolders).map(subfolder => (
            <Button
              key={subfolder.path}
              variant="light"
              size={buttonSize}
              onClick={() => {
                window.location.href = `/album/folder/${encodeURIComponent(subfolder.path)}`;
              }}
              styles={{
                root: {
                  minHeight: isMobile ? '32px' : '28px',
                  padding: isMobile ? '4px 8px' : '2px 6px',
                  fontSize: isSmallMobile ? '12px' : isMobile ? '13px' : '14px'
                }
              }}
              title={subfolder.name} // Show full name on hover
            >
              {isSmallMobile ? (
                // On very small screens, show just icon and count
                <Group gap={4} style={{ fontSize: '11px' }}>
                  📁 {subfolder.photo_count}
                </Group>
              ) : (
                // On larger screens, show truncated name and count
                `📁 ${truncateFolderName(subfolder.name)} (${subfolder.photo_count})`
              )}
            </Button>
          ))}

          {/* Show remaining folders count */}
          {subfolders.length > maxFolders && (
            <Box
              style={{
                fontSize: isSmallMobile ? '11px' : isMobile ? '12px' : '13px',
                color: 'var(--mantine-color-dimmed)',
                display: 'flex',
                alignItems: 'center',
                padding: '4px 8px',
                minHeight: isMobile ? '32px' : '28px',
                backgroundColor: 'var(--mantine-color-body)',
                borderRadius: 'var(--mantine-radius-sm)',
                border: '1px solid var(--mantine-color-default-border)'
              }}
            >
              +{subfolders.length - maxFolders} more
            </Box>
          )}
        </Group>
      </Box>
    );
  }

  return (
    <PhotoListView
      title={folderPath.split('/').pop() || t("folder", { defaultValue: "Folder" })}
      additionalSubHeader={getSubheader()}
      loading={isLoading}
      icon={<Folder size={50} />}
      photoset={photosGroupedByDate ?? []}
      updateGroups={getAlbums}
      idx2hash={photosFlat}
      selectable
    />
  );
}