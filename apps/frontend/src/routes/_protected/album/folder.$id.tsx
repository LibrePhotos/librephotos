import {
  Avatar,
  Badge,
  Box,
  Button,
  Group,
  Highlight,
  MantineFontSize,
  Modal,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import { useDisclosure, useMediaQuery } from "@mantine/hooks";
import { IconFolder as Folder, IconArrowLeft, IconSearch } from "@tabler/icons-react";
import { createFileRoute, Link } from "@tanstack/react-router";
import React, { memo, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  SubfolderInfo,
  useFetchDateAlbumQuery,
  useFetchDateAlbumsQuery,
  useFetchFolderSubfoldersInfiniteQuery,
  useFetchFolderSubfoldersQuery,
} from "../../../api_client/albums/hooks";
import { Photoset, PigPhoto } from "../../../api_client/photos/types";
import { PhotoGroup, PhotoListView } from "../../../components/photolist/PhotoListView";
import type { PigVisibleGroup } from "../../../components/react-pig";
import { getPhotosFlatFromGroupedByDate } from "../../../util/util";
import classes from "./folder.module.css";

export const Route = createFileRoute("/_protected/album/folder/$id")({
  component: FolderDetail,
  // A new page per folder: navigating between folders keeps this route mounted,
  // which carried the selection (and a select-all of the old folder) along.
  remountDeps: ({ params }) => params.id,
});

// The last segment of a path from the server, which on Windows mixes \ and /
const folderName = (path: string) => path.split(/[\\/]/).pop();

type FolderButtonProps = {
  subfolder: SubfolderInfo;
  folderSearch: string;
  onClose?: () => void;
};

// Memoized FolderButton component with Mantine components
const FolderButton = memo(({ subfolder, folderSearch, onClose }: FolderButtonProps) => {
  // Helper function to truncate path intelligently
  const truncatePath = (path: string, maxLength: number = 50) => {
    if (path.length <= maxLength) return path;
    // Try to break at folder separators
    const parts = path.split("/");
    let result = parts[parts.length - 1]; // Start with filename

    for (let i = parts.length - 2; i >= 0; i -= 1) {
      const newResult = `${parts[i]}/${result}`;
      if (newResult.length > maxLength - 3) break; // Leave room for "..."
      result = newResult;
    }

    return result.length < path.length ? `...${result}` : result;
  };

  return (
    <UnstyledButton
      // renderRoot, not component={Link}: only this way are `to` and `params` type-checked
      renderRoot={props => (
        <Link to="/album/folder/$id" params={{ id: encodeURIComponent(subfolder.path) }} {...props} />
      )}
      title={subfolder.path}
      className={classes.folderButton}
      onClick={onClose}
    >
      <Group gap="md" justify="space-between" align="center" wrap="nowrap">
        <Group gap="md" align="center" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
          {/* Folder icon */}
          <Avatar size="lg" radius="md" color="blue">
            <Folder size={24} />
          </Avatar>

          {/* Text content */}
          <Box style={{ flex: 1, minWidth: 0 }}>
            <Stack gap={4}>
              {/* Folder name; Highlight is a Text itself, a <p> inside a <p> before */}
              <Highlight highlight={folderSearch} size="sm" fw={600} lineClamp={1} ta="left">
                {subfolder.name}
              </Highlight>

              {/* Folder path */}
              <Highlight highlight={folderSearch} size="xs" c="dimmed" lineClamp={1} ta="left">
                {truncatePath(subfolder.path)}
              </Highlight>
            </Stack>
          </Box>
        </Group>
        <Badge
          size="xl"
          radius="xl"
          variant="filled"
          color="blue"
          style={{
            fontSize: "var(--mantine-font-size-md)",
            fontWeight: 700,
            padding: "8px 16px",
            minWidth: "56px",
            textAlign: "center",
            alignSelf: "center",
          }}
        >
          {subfolder.photo_count}
        </Badge>
      </Group>
    </UnstyledButton>
  );
});

FolderButton.displayName = "FolderButton";

// FolderListModal component - encapsulates all modal functionality
interface FolderListModalProps {
  folderPath?: string;
  subfolders: readonly SubfolderInfo[];
  /** How many of them the header already shows as buttons. */
  visibleCount: number;
  buttonSize: string;
  isMobile: boolean;
}

const FolderListModal = memo<FolderListModalProps>(
  ({ folderPath, subfolders, visibleCount, buttonSize, isMobile }: FolderListModalProps) => {
    const { t } = useTranslation();
    const [folderSearch, setFolderSearch] = useState("");
    const [opened, { open, close }] = useDisclosure(false);
    // State, not a ref: the modal mounts its body after opening, and the
    // observer below has to be set up again once the sentinel exists.
    const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);

    const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useFetchFolderSubfoldersInfiniteQuery(folderPath);

    const allSubfolders = useMemo(() => data?.pages?.flatMap(p => p.subfolders) || [], [data]);

    const filteredSubfolders = useMemo(() => {
      const query = folderSearch.trim().toLowerCase();
      if (!query) return allSubfolders;
      return allSubfolders.filter(f => f.name.toLowerCase().includes(query) || f.path.toLowerCase().includes(query));
    }, [allSubfolders, folderSearch]);

    // One observer per open list, disconnected again: an inline ref callback
    // made a new one on every render and never let any of them go. A new one per
    // page, as it reports at once whether the end is (still) in view.
    const pageCount = data?.pages?.length ?? 0;
    useEffect(() => {
      if (!sentinel || !hasNextPage) return undefined;
      const observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting) && !isFetchingNextPage) {
          fetchNextPage();
        }
      });
      observer.observe(sentinel);
      return () => observer.disconnect();
    }, [sentinel, hasNextPage, isFetchingNextPage, fetchNextPage, pageCount]);

    return (
      <>
        <Modal
          opened={opened}
          onClose={close}
          title={`${t("all_subfolders", { defaultValue: "All subfolders" })}`}
          size={isMobile ? "90%" : "lg"}
          centered
          scrollAreaComponent={ScrollArea.Autosize}
          withCloseButton
        >
          <Stack gap="sm">
            <TextInput
              value={folderSearch}
              onChange={event => {
                setFolderSearch(event.currentTarget.value);
              }}
              placeholder={t("filter_folders", { defaultValue: "Filter by name or path..." })}
              leftSection={<IconSearch size={16} />}
              size="md"
              radius="md"
            />

            <Group justify="space-between" align="center">
              <Text size="sm" c="dimmed" fw={500}>
                {t("results", { defaultValue: "Results" })}: {filteredSubfolders.length}
              </Text>
              {hasNextPage && (
                <Badge variant="light" color="blue" size="sm">
                  {t("more_available", { defaultValue: "More available" })}
                </Badge>
              )}
            </Group>
            <ScrollArea.Autosize mah={600} type="auto">
              <Stack gap="lg" p="md">
                {filteredSubfolders.map(subfolder => (
                  <FolderButton
                    key={subfolder.path}
                    subfolder={subfolder}
                    folderSearch={folderSearch}
                    onClose={close}
                  />
                ))}
                {/* Infinite scroll sentinel */}
                <div ref={setSentinel} />
                {filteredSubfolders.length === 0 && (
                  <Box ta="center" py="xl">
                    <Stack gap="xs" align="center">
                      <Avatar size="lg" radius="xl" variant="light" color="gray">
                        <Folder size={24} />
                      </Avatar>
                      <Text size="sm" c="dimmed" fw={500}>
                        {t("no_folders_found", { defaultValue: "No folders found" })}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {t("try_different_search", { defaultValue: "Try adjusting your search terms" })}
                      </Text>
                    </Stack>
                  </Box>
                )}
              </Stack>
            </ScrollArea.Autosize>
          </Stack>
        </Modal>

        {/* Trigger button */}
        {subfolders.length > visibleCount && (
          <Button
            variant="default"
            size={buttonSize}
            onClick={open}
            styles={{
              root: {
                minHeight: isMobile ? "32px" : "28px",
                padding: isMobile ? "4px 8px" : "2px 6px",
                fontSize: isMobile ? "12px" : "13px",
              },
            }}
            title={t("show_all_subfolders", { defaultValue: "Show all subfolders" })}
          >
            +{subfolders.length - visibleCount} {t("more", { defaultValue: "more" })}
          </Button>
        )}
      </>
    );
  }
);

FolderListModal.displayName = "FolderListModal";

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
  const [photosFlat, setPhotosFlat] = useState<PigPhoto[]>([]);
  // Responsive breakpoints
  const isMobile = useMediaQuery("(max-width: 768px)");
  const isSmallMobile = useMediaQuery("(max-width: 480px)");

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

  // No group to fetch until the grid asks for one
  const [group, setGroup] = useState<PhotoGroup>({ id: "", page: 0 });

  useFetchDateAlbumQuery(
    { album_date_id: group.id, page: group.page, photosetType: Photoset.NONE, folder: folderPath },
    { skip: !group.id }
  );

  const getAlbums = (visibleGroups: PigVisibleGroup<PigPhoto>[]) => {
    visibleGroups.reverse().forEach(photoGroup => {
      const visibleImages = photoGroup.items;
      if (visibleImages.filter(i => i.isTemp).length > 0) {
        const firstTempObject = visibleImages.filter(i => i.isTemp)[0];
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
              {isSmallMobile
                ? t("back", { defaultValue: "Back" })
                : t("back_to_parent", { defaultValue: "Back to Parent" })}
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
              {isSmallMobile
                ? t("folders", { defaultValue: "Folders" })
                : t("back_to_folders", { defaultValue: "Back to Folders" })}
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
          <FolderListModal
            folderPath={folderPath}
            subfolders={subfolders}
            visibleCount={maxFolders}
            buttonSize={buttonSize}
            isMobile={isMobile}
          />
        </Group>
      </Box>
    );
  }

  return (
    <PhotoListView
      title={folderName(folderPath) || t("folder", { defaultValue: "Folder" })}
      additionalSubHeader={getSubheader()}
      loading={isLoading}
      icon={<Folder size={50} />}
      photoset={photosGroupedByDate ?? []}
      updateGroups={getAlbums}
      idx2hash={photosFlat}
      photosetQuery={{ folder: folderPath }}
      selectable
    />
  );
}
