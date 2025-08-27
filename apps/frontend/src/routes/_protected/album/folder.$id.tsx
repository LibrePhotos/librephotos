import { createFileRoute } from '@tanstack/react-router';

import { Group, Button, Box, Modal, TextInput, ScrollArea, Stack, Text, Highlight, Badge, Avatar, UnstyledButton } from "@mantine/core";
import { IconFolder as Folder, IconArrowLeft } from "@tabler/icons-react";
import React, { useEffect, useState, useMemo, memo } from "react";
import { useTranslation } from "react-i18next";
import { useMediaQuery, useDisclosure } from "@mantine/hooks";
import { Link } from "@tanstack/react-router";


import { PigPhoto } from "../../../api_client/photos/types";
import { useFetchDateAlbumsQuery, useFetchDateAlbumQuery } from "../../../api_client/albums/hooks";
import { PhotoListView, PhotoGroup } from "../../../components/photolist/PhotoListView";
import { Photoset } from "../../../api_client/photos/types";
import { getPhotosFlatFromGroupedByDate } from "../../../util/util";
import { useFetchFolderSubfoldersQuery, useFetchFolderSubfoldersInfiniteQuery } from "../../../api_client/albums/hooks";
import classes from './folder.module.css';

export const Route = createFileRoute('/_protected/album/folder/$id')({
  component: FolderDetail,
});

// FolderListModal component - encapsulates all modal functionality
interface FolderListModalProps {
  folderPath?: string;
  subfolders: any[];
  buttonSize: string;
  isMobile: boolean;
}

const FolderListModal = memo<FolderListModalProps>(({ folderPath, subfolders, buttonSize, isMobile }) => {
  const { t } = useTranslation();
  const [folderSearch, setFolderSearch] = useState("");
  const [opened, { open, close }] = useDisclosure(false);

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useFetchFolderSubfoldersInfiniteQuery(folderPath);

  const allSubfolders = useMemo(() => {
    return data?.pages?.flatMap((p) => p.subfolders) || [];
  }, [data]);

  const filteredSubfolders = useMemo(() => {
    const query = folderSearch.trim().toLowerCase();
    if (!query) return allSubfolders;
    return allSubfolders.filter((f: any) =>
      f.name.toLowerCase().includes(query) || f.path.toLowerCase().includes(query)
    );
  }, [allSubfolders, folderSearch]);

  // Memoized FolderButton component with Mantine components
  const FolderButton = memo<{
    subfolder: any;
    folderSearch: string;
  }>(({ subfolder, folderSearch }) => {
    // Helper function to truncate path intelligently
    const truncatePath = (path: string, maxLength: number = 50) => {
      if (path.length <= maxLength) return path;
      // Try to break at folder separators
      const parts = path.split('/');
      let result = parts[parts.length - 1]; // Start with filename

      for (let i = parts.length - 2; i >= 0; i--) {
        const newResult = parts[i] + '/' + result;
        if (newResult.length > maxLength - 3) break; // Leave room for "..."
        result = newResult;
      }

      return result.length < path.length ? '...' + result : result;
    };

    return (
      <UnstyledButton
        component={Link}
        to={`/album/folder/${encodeURIComponent(subfolder.path)}`}
        variant="light"
        size="lg"
        title={subfolder.path}
        className={classes.folderButton}
        onClick={() => {
          close();
        }}
      >
        <Group gap="md" justify="space-between" align="center" wrap="nowrap">
          <Group gap="md" align="center" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
            {/* Folder icon */}
            <Avatar
              size="lg"
              radius="md"
              color="blue"
            >
              📁
            </Avatar>

            {/* Text content */}
            <Box style={{ flex: 1, minWidth: 0 }}>
              <Stack gap={4}>
                {/* Folder name */}
                <Text
                  size="sm"
                  fw={600}
                  lineClamp={1}
                  ta="left"
                >
                  <Highlight highlight={folderSearch}>
                    {subfolder.name}
                  </Highlight>
                </Text>

                {/* Folder path */}
                <Text
                  size="xs"
                  c="dimmed"
                  lineClamp={1}
                  ta="left"
                >
                  <Highlight highlight={folderSearch}>
                    {truncatePath(subfolder.path)}
                  </Highlight>
                </Text>
              </Stack>
            </Box>
          </Group>
          <Badge
            size="xl"
            radius="xl"
            variant="filled"
            color="blue"
            style={{
              fontSize: 'var(--mantine-fontSizes-lg)',
              fontWeight: 700,
              padding: '8px 16px',
              minWidth: '56px',
              textAlign: 'center',
              alignSelf: 'center'
            }}
          >
            {subfolder.photo_count}
          </Badge>
        </Group>
      </UnstyledButton>
    );
  });

  FolderButton.displayName = 'FolderButton';

  const maxFolders = 6; // We only need this for the trigger button logic

  return (
    <>
      <Modal
        opened={opened}
        onClose={close}
        title={`${t('all_subfolders', { defaultValue: 'All subfolders' })}`}
        size={isMobile ? '90%' : 'lg'}
        centered
        scrollAreaComponent={ScrollArea.Autosize}
        withCloseButton
      >
        <Stack gap="sm">
          <TextInput
            value={folderSearch}
            onChange={(event) => {
              setFolderSearch(event.currentTarget.value);
            }}
            placeholder={t('filter_folders', { defaultValue: 'Filter by name or path...' })}
            leftSection={<span style={{ fontSize: '16px' }}>🔍</span>}
            size="md"
            radius="md"
            styles={{
              input: {
                '&:focus': {
                  borderColor: 'var(--mantine-color-blue-5)',
                  boxShadow: '0 0 0 2px rgba(59, 130, 246, 0.1)'
                }
              }
            }}
          />

          <Group justify="space-between" align="center">
            <Text size="sm" c="dimmed" fw={500}>
              {t('results', { defaultValue: 'Results' })}: {filteredSubfolders.length}
            </Text>
            {hasNextPage && (
              <Badge variant="light" color="blue" size="sm">
                {t('more_available', { defaultValue: 'More available' })}
              </Badge>
            )}
          </Group>
          <ScrollArea.Autosize mah={600} type="auto">
            <Stack gap="lg" p="md">
              {filteredSubfolders.map((subfolder: any) => (
                <FolderButton
                  key={subfolder.path}
                  subfolder={subfolder}
                  folderSearch={folderSearch}
                />
              ))}
              {/* Infinite scroll sentinel */}
              <div
                ref={(node) => {
                  if (!node) return;
                  const observer = new IntersectionObserver((entries) => {
                    entries.forEach((entry) => {
                      if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) {
                        fetchNextPage();
                      }
                    });
                  });
                  observer.observe(node);
                }}
              />
              {filteredSubfolders.length === 0 && (
                <Box ta="center" py="xl">
                  <Stack gap="xs" align="center">
                    <Avatar size="lg" radius="xl" style={{ backgroundColor: 'var(--mantine-color-gray-1)' }}>
                      📁
                    </Avatar>
                    <Text size="sm" c="dimmed" fw={500}>
                      {t('no_folders_found', { defaultValue: 'No folders found' })}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {t('try_different_search', { defaultValue: 'Try adjusting your search terms' })}
                    </Text>
                  </Stack>
                </Box>
              )}
            </Stack>
          </ScrollArea.Autosize>
        </Stack>
      </Modal>

      {/* Trigger button */}
      {subfolders.length > maxFolders && (
        <Button
          variant="default"
          size={buttonSize}
          onClick={open}
          styles={{
            root: {
              minHeight: isMobile ? '32px' : '28px',
              padding: isMobile ? '4px 8px' : '2px 6px',
              fontSize: isMobile ? '12px' : '13px'
            }
          }}
          title={t('show_all_subfolders', { defaultValue: 'Show all subfolders' })}
        >
          +{subfolders.length - maxFolders} {t('more', { defaultValue: 'more' })}
        </Button>
      )}
    </>
  );
});

FolderListModal.displayName = 'FolderListModal';

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
  const subfolders = folderData?.subfolders || [];

  useEffect(() => {
    if (photosGroupedByDate) {
      setPhotosFlat(getPhotosFlatFromGroupedByDate(photosGroupedByDate));
    }
  }, [photosGroupedByDate]);

  const [group, setGroup] = useState({} as PhotoGroup);

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
      return `${name.substring(0, maxFolderNameLength - 3)  }...`;
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

          {/* Folder list modal with trigger button */}
          <FolderListModal
            folderPath={folderPath}
            subfolders={subfolders}
            buttonSize={buttonSize}
            isMobile={isMobile}
          />
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