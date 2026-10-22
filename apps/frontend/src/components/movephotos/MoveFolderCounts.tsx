import type { MoveFolderCount } from "@librephotos/api-client";
import { Badge, Group, Paper, Stack, Text } from "@mantine/core";
import { IconFolder, IconFolderPlus } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import classes from "./MovePhotosModal.module.css";

type Props = Readonly<{
  /** The destination the folders are in. */
  target: string;
  folders: readonly MoveFolderCount[];
}>;

// The folders listed; the rest are counted.
const LISTED = 8;

/** A folder's path below the destination (`2025/06`). */
const below = (target: string, path: string) =>
  path.length > target.length ? path.slice(target.length).replace(/^[\\/]+/, "") : path;

/** What one folder of a sort by date gets: the photos that move in, those already there, taken names. */
function FolderLine({ folder, target }: Readonly<{ folder: MoveFolderCount; target: string }>) {
  const { t } = useTranslation();
  const counts = [
    folder.photos > 0 ? t("movephotos.folderphotos", { count: folder.photos }) : null,
    folder.unchanged > 0 ? t("movephotos.folderunchanged", { count: folder.unchanged }) : null,
    folder.clashes > 0 ? t("movephotos.folderclashes", { count: folder.clashes }) : null,
  ].filter(part => part !== null);
  const Icon = folder.new ? IconFolderPlus : IconFolder;
  return (
    <Group gap="xs" wrap="nowrap" justify="space-between">
      <Group gap={6} wrap="nowrap" miw={0}>
        <Icon size={16} aria-hidden />
        <Text size="sm" ff="monospace" className={classes.ellipsis}>
          {below(target, folder.path)}
        </Text>
        {folder.new && (
          <Badge size="xs" color="teal" variant="light">
            {t("movephotos.newbadge")}
          </Badge>
        )}
      </Group>
      <Text size="xs" c={folder.clashes > 0 ? "orange" : "dimmed"} className={classes.nowrap}>
        {counts.join(" · ")}
      </Text>
    </Group>
  );
}

/** The folders a sort by date (#2774) moves the photos into, with what each gets. */
export function MoveFolderCounts({ target, folders }: Props) {
  const { t } = useTranslation();
  if (folders.length === 0) return null;
  const more = folders.length - LISTED;
  return (
    <Paper withBorder radius="sm" p="xs">
      <Stack gap={4} role="list" aria-label={t("movephotos.folderslabel")}>
        {folders.slice(0, LISTED).map(folder => (
          <div role="listitem" key={folder.path}>
            <FolderLine folder={folder} target={target} />
          </div>
        ))}
        {more > 0 && (
          <Text size="xs" c="dimmed">
            {t("movephotos.morefolders", { count: more })}
          </Text>
        )}
      </Stack>
    </Paper>
  );
}
