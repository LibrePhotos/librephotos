import type { FolderSubfolder } from "@librephotos/api-client";
import {
  Avatar,
  Badge,
  Box,
  Group,
  Highlight,
  Modal,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import { IconFolder as Folder, IconSearch } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import React, { memo, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchFolderSubfoldersInfiniteQuery } from "../../api_client/albums/hooks";
import { Tile } from "../Tile";
import classes from "./FolderListModal.module.css";

type FolderButtonProps = {
  subfolder: FolderSubfolder;
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
    let result = parts[parts.length - 1] ?? path; // Start with filename

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
          {/* The folder's newest photo (#2233), else the folder icon; Avatar lg is 56 px */}
          {subfolder.cover_photo?.image_hash ? (
            <Box className={classes.coverBox}>
              <Tile
                className={classes.cover}
                image_hash={subfolder.cover_photo.image_hash}
                video={subfolder.cover_photo.video}
                width={56}
                height={56}
              />
            </Box>
          ) : (
            <Avatar size="lg" radius="md" color="blue">
              <Folder size={24} />
            </Avatar>
          )}

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

// The most folders the list mounts at once; the filter reaches the others. A folder can hold
// thousands of subfolders, and every loaded page used to stay mounted.
export const FOLDER_LIST_CAP = 100;

type FolderListModalProps = {
  opened: boolean;
  onClose: () => void;
  folderPath?: string;
  isMobile: boolean;
};

// The list behind the "+N more" button of a folder page. The parent holds its open state.
const FolderListModal = memo<FolderListModalProps>(
  ({ opened, onClose, folderPath, isMobile }: FolderListModalProps) => {
    const { t } = useTranslation();
    const [folderSearch, setFolderSearch] = useState("");
    // State, not a ref: the modal mounts its body after opening, and the
    // observer below has to be set up again once the sentinel exists.
    const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);

    const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useFetchFolderSubfoldersInfiniteQuery(folderPath);

    const allSubfolders = useMemo(() => data?.pages?.flatMap(p => p.results) || [], [data]);

    const filteredSubfolders = useMemo(() => {
      const query = folderSearch.trim().toLowerCase();
      if (!query) return allSubfolders;
      return allSubfolders.filter(f => f.name.toLowerCase().includes(query) || f.path.toLowerCase().includes(query));
    }, [allSubfolders, folderSearch]);
    const shownSubfolders = filteredSubfolders.slice(0, FOLDER_LIST_CAP);

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
      <Modal
        opened={opened}
        onClose={onClose}
        title={`${t("all_subfolders")}`}
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
            placeholder={t("filter_folders")}
            leftSection={<IconSearch size={16} />}
            size="md"
            radius="md"
          />

          <Group justify="space-between" align="center">
            <Text size="sm" c="dimmed" fw={500}>
              {t("results")}: {filteredSubfolders.length}
            </Text>
            {hasNextPage && (
              <Badge variant="light" color="blue" size="sm">
                {t("more_available")}
              </Badge>
            )}
          </Group>
          <ScrollArea.Autosize mah={600} type="auto">
            <Stack gap="lg" p="md">
              {shownSubfolders.map(subfolder => (
                <FolderButton
                  key={subfolder.path}
                  subfolder={subfolder}
                  folderSearch={folderSearch}
                  onClose={onClose}
                />
              ))}
              {filteredSubfolders.length > shownSubfolders.length && (
                <Text size="sm" c="dimmed" ta="center">
                  {t("folder_list_capped", { shown: shownSubfolders.length, count: filteredSubfolders.length })}
                </Text>
              )}
              {/* Infinite scroll sentinel: the filter searches every page, so they still load */}
              <div ref={setSentinel} />
              {filteredSubfolders.length === 0 && (
                <Box ta="center" py="xl">
                  <Stack gap="xs" align="center">
                    <Avatar size="lg" radius="xl" variant="light" color="gray">
                      <Folder size={24} />
                    </Avatar>
                    <Text size="sm" c="dimmed" fw={500}>
                      {t("no_folders_found")}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {t("try_different_search")}
                    </Text>
                  </Stack>
                </Box>
              )}
            </Stack>
          </ScrollArea.Autosize>
        </Stack>
      </Modal>
    );
  }
);

FolderListModal.displayName = "FolderListModal";

export { FolderListModal };
