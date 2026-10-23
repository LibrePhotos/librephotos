import type { LibraryFolderEntry } from "@librephotos/api-client";
import { ActionIcon, Badge, Group, Menu, Paper, Stack, Text } from "@mantine/core";
import {
  IconDotsVertical,
  IconFolder,
  IconFolderMinus,
  IconFolderOff,
  IconFolderOpen,
  IconTrash,
} from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE } from "../../uiConstants";
import classes from "./LibraryFolderRow.module.css";

type Props = Readonly<{
  folder: LibraryFolderEntry;
  /** How many folders inside it are left out of the library (#791). */
  leftOutCount: number;
  /** Offered for a further folder when the viewer may remove it (admins). */
  onRemove?: () => void;
  /** Offered in the owner's own list, for a folder that can be read (#791). */
  onLeaveOut?: () => void;
}>;

function KindBadge({ folder }: Readonly<{ folder: LibraryFolderEntry }>) {
  const { t } = useTranslation();
  if (!folder.available) {
    return (
      <Badge size="xs" variant="light" color="orange">
        {t("libraryfolders.notfound")}
      </Badge>
    );
  }
  if (folder.kind === "main") {
    return (
      <Badge size="xs" variant="light">
        {t("libraryfolders.main")}
      </Badge>
    );
  }
  if (folder.kind === "upload") {
    return (
      <Badge size="xs" variant="light" color="gray">
        {t("libraryfolders.upload")}
      </Badge>
    );
  }
  return null;
}

/** One folder of a library (#123): its path, what it is, its photos, and its actions. */
function Subtitle({ folder, leftOutCount }: Readonly<{ folder: LibraryFolderEntry; leftOutCount: number }>) {
  const { t } = useTranslation();
  const parts = [t("libraryfolders.photocount", { count: folder.photo_count })];
  if (leftOutCount > 0) parts.push(t("libraryfolders.leftoutcount", { count: leftOutCount }));
  if (!folder.available) parts.push(t("libraryfolders.notfoundhint"));
  return (
    <Text size="xs" c="dimmed">
      {parts.join(" · ")}
    </Text>
  );
}

export function LibraryFolderRow({ folder, leftOutCount, onRemove, onLeaveOut }: Props) {
  const { t } = useTranslation();
  const FolderIcon = folder.available ? IconFolder : IconFolderOff;
  return (
    <Paper withBorder radius="sm" px="sm" py="xs">
      <Group wrap="nowrap" gap="sm">
        <FolderIcon size={ICON_SIZE.toolbar} stroke={1.5} className={classes.icon} aria-hidden />
        <Stack gap={0} flex={1} miw={0}>
          <Group gap="xs" wrap="wrap">
            <Text size="sm" ff="monospace" className={classes.path}>
              {folder.path}
            </Text>
            <KindBadge folder={folder} />
          </Group>
          <Subtitle folder={folder} leftOutCount={leftOutCount} />
        </Stack>
        <Menu position="bottom-end" withinPortal>
          <Menu.Target>
            <ActionIcon variant="subtle" color="gray" aria-label={t("libraryfolders.actions")}>
              <IconDotsVertical size={ICON_SIZE.inline} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item
              leftSection={<IconFolderOpen size={ICON_SIZE.menu} />}
              renderRoot={props => (
                <Link to="/album/folder/$id" params={{ id: encodeURIComponent(folder.path) }} {...props} />
              )}
            >
              {t("libraryfolders.open")}
            </Menu.Item>
            {onLeaveOut && folder.available && (
              <Menu.Item leftSection={<IconFolderMinus size={ICON_SIZE.menu} />} onClick={onLeaveOut}>
                {t("libraryfolders.leaveout")}
              </Menu.Item>
            )}
            {onRemove && folder.kind === "folder" && (
              <Menu.Item color="red" leftSection={<IconTrash size={ICON_SIZE.menu} />} onClick={onRemove}>
                {t("libraryfolders.remove")}
              </Menu.Item>
            )}
          </Menu.Dropdown>
        </Menu>
      </Group>
    </Paper>
  );
}
