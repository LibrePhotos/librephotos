import type { PigPhoto } from "@librephotos/api-client";
import { Photoset } from "@librephotos/api-client";
import type { MantineFontSize } from "@mantine/core";
import { Box, Button, Group, useMantineTheme } from "@mantine/core";
import { useDisclosure, useMediaQuery } from "@mantine/hooks";
import { IconFolder as Folder, IconArrowLeft } from "@tabler/icons-react";
import { createFileRoute, Link } from "@tanstack/react-router";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useFetchDateAlbumQuery,
  useFetchDateAlbumsQuery,
  useFetchFolderSubfoldersQuery,
} from "../../../api_client/albums/hooks";
import { FolderActionsMenu } from "../../../components/album/FolderActionsMenu";
import { FolderListModal } from "../../../components/album/FolderListModal";
import { mediaTypeToBulkQuery, validateMediaSearch } from "../../../components/photolist/mediaTypeFilter";
import { PhotoListView } from "../../../components/photolist/PhotoListView";
import type { PhotoGroup, PigVisibleGroup } from "../../../components/photolist/PhotoListView";
import { useMediaTypeFilter } from "../../../components/photolist/useMediaTypeFilter";
import { getPhotosFlatFromGroupedByDate } from "../../../util/util";

export const Route = createFileRoute("/_protected/album/folder/$id")({
  component: FolderDetail,
  // A new page per folder: navigating between folders keeps this route mounted,
  // which carried the selection (and a select-all of the old folder) along.
  remountDeps: ({ params }) => params.id,
  validateSearch: validateMediaSearch,
});

// The last segment of a path from the server, which on Windows mixes \ and /
const folderName = (path: string) => path.split(/[\\/]/).pop();

function getFontSize(isSmallMobile: boolean, isMobile: boolean): MantineFontSize {
  if (isSmallMobile) return "12px";
  return isMobile ? "13px" : "14px";
}

function getMaxFolders(isSmallMobile: boolean, isMobile: boolean): number {
  if (isSmallMobile) return 3;
  return isMobile ? 4 : 6;
}

function getMaxFolderNameLength(isSmallMobile: boolean, isMobile: boolean): number {
  if (isSmallMobile) return 12;
  return isMobile ? 15 : 20;
}

// The id is the encoded folder path. A malformed one (a folder name with a bare
// "%" reached through an old link) is taken as it is rather than throwing.
function decodeFolderId(id: string): string {
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

function FolderDetail() {
  const { id } = Route.useParams();
  const folderPath = decodeFolderId(id);
  const { t } = useTranslation();
  const mediaType = useMediaTypeFilter();
  const [photosFlat, setPhotosFlat] = useState<PigPhoto[]>([]);
  const [folderListOpened, { open: openFolderList, close: closeFolderList }] = useDisclosure(false);
  // Responsive breakpoints, in the theme's em values so they follow the browser font size
  const theme = useMantineTheme();
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);
  const isSmallMobile = useMediaQuery(`(max-width: ${theme.breakpoints.xs})`);

  // Get photos from this folder using FOLDERS photoset
  const { data: photosGroupedByDate, isLoading } = useFetchDateAlbumsQuery({
    photosetType: Photoset.NONE,
    folder: folderPath,
    mediaType,
  });

  // Get subfolders for navigation
  const { data: folderData } = useFetchFolderSubfoldersQuery(folderPath);
  const subfolders = folderData?.results || [];

  useEffect(() => {
    if (photosGroupedByDate) {
      setPhotosFlat(getPhotosFlatFromGroupedByDate(photosGroupedByDate));
    }
  }, [photosGroupedByDate]);

  // No group to fetch until the grid asks for one
  const [group, setGroup] = useState<PhotoGroup>({ id: 0, page: 0 });

  useFetchDateAlbumQuery(
    { album_date_id: group.id, page: group.page, photosetType: Photoset.NONE, folder: folderPath, mediaType },
    { skip: !group.id }
  );

  const getAlbums = (visibleGroups: PigVisibleGroup<PigPhoto>[]) => {
    visibleGroups.reverse().forEach(photoGroup => {
      const visibleImages = photoGroup.items;
      const firstTempObject = visibleImages.find(i => i.isTemp);
      if (firstTempObject) {
        const page = Math.ceil((parseInt(firstTempObject.id, 10) + 1) / 100);

        setGroup({ id: photoGroup.id, page });
      }
    });
  };

  function getSubheader() {
    // The server knows where the library ends (null at the scan directory) and
    // how its paths are separated; cutting at the last "/" walked out of the
    // library, and on Windows skipped a level. The cut is only a stand-in until
    // it answers, so the button does not change its label on every page load.
    const parentPath = folderData
      ? folderData.parent_path
      : folderPath.substring(0, folderPath.lastIndexOf("/")) || null;
    const canGoBack = Boolean(parentPath) && parentPath !== folderPath;

    // Responsive settings
    const maxFolders = getMaxFolders(isSmallMobile, isMobile);
    const buttonSize = isMobile ? "sm" : "xs";
    const iconSize = isMobile ? 16 : 14;
    const maxFolderNameLength = getMaxFolderNameLength(isSmallMobile, isMobile);

    // Truncate folder names for mobile
    const truncateFolderName = (name: string) => {
      if (name.length <= maxFolderNameLength) return name;
      return `${name.substring(0, maxFolderNameLength - 3)}...`;
    };

    return (
      <Box style={{ marginTop: isMobile ? "12px" : "16px", marginBottom: isMobile ? "12px" : "16px" }}>
        <Group
          gap={isSmallMobile ? "xs" : "sm"}
          style={{
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          {/* Back button */}
          {canGoBack ? (
            <Button
              renderRoot={props => (
                <Link to="/album/folder/$id" params={{ id: encodeURIComponent(parentPath ?? "") }} {...props} />
              )}
              variant="subtle"
              size={buttonSize}
              leftSection={<IconArrowLeft size={iconSize} />}
              styles={{
                root: {
                  minHeight: isMobile ? "32px" : "28px",
                  padding: isMobile ? "4px 8px" : "2px 6px",
                },
              }}
            >
              {isSmallMobile ? t("back") : t("back_to_parent")}
            </Button>
          ) : (
            <Button
              // exact: every folder page is "under" /album/folder, which marked this the current page
              renderRoot={props => <Link to="/album/folder" activeOptions={{ exact: true }} {...props} />}
              variant="subtle"
              size={buttonSize}
              leftSection={<IconArrowLeft size={iconSize} />}
              styles={{
                root: {
                  minHeight: isMobile ? "32px" : "28px",
                  padding: isMobile ? "4px 8px" : "2px 6px",
                },
              }}
            >
              {isSmallMobile ? t("folders") : t("back_to_folders")}
            </Button>
          )}

          {/* Folder buttons */}
          {subfolders.slice(0, maxFolders).map(subfolder => (
            <Button
              key={subfolder.path}
              renderRoot={props => (
                <Link to="/album/folder/$id" params={{ id: encodeURIComponent(subfolder.path) }} {...props} />
              )}
              variant="light"
              size={buttonSize}
              leftSection={<Folder size={iconSize} />}
              styles={{
                root: {
                  minHeight: isMobile ? "32px" : "28px",
                  padding: isMobile ? "4px 8px" : "2px 6px",
                  fontSize: getFontSize(isSmallMobile, isMobile),
                },
              }}
              title={subfolder.name} // Show full name on hover
            >
              {isSmallMobile
                ? // On very small screens, show just icon and count
                  subfolder.photo_count
                : // On larger screens, show truncated name and count
                  `${truncateFolderName(subfolder.name)} (${subfolder.photo_count})`}
            </Button>
          ))}

          {/* Folder list modal with trigger button */}
          {subfolders.length > maxFolders && (
            <Button
              variant="default"
              size={buttonSize}
              onClick={openFolderList}
              styles={{
                root: {
                  minHeight: isMobile ? "32px" : "28px",
                  padding: isMobile ? "4px 8px" : "2px 6px",
                  fontSize: isMobile ? "12px" : "13px",
                },
              }}
              title={t("show_all_subfolders")}
            >
              {t("moresubfolders", { count: subfolders.length - maxFolders })}
            </Button>
          )}
          <FolderListModal
            opened={folderListOpened}
            onClose={closeFolderList}
            folderPath={folderPath}
            isMobile={isMobile}
          />
        </Group>
      </Box>
    );
  }

  const title = folderName(folderPath) || t("folder");
  return (
    <PhotoListView
      title={title}
      additionalSubHeader={getSubheader()}
      // An empty folder has no photos to detect faces in.
      headerActions={
        photosFlat.length > 0 ? (
          <FolderActionsMenu folderPath={folderPath} folderName={title} photoCount={photosFlat.length} />
        ) : undefined
      }
      loading={isLoading}
      icon={Folder}
      photoset={photosGroupedByDate ?? []}
      updateGroups={getAlbums}
      idx2hash={photosFlat}
      mediaType={mediaType}
      photosetQuery={{ folder: folderPath, ...mediaTypeToBulkQuery(mediaType) }}
      selectable
    />
  );
}
