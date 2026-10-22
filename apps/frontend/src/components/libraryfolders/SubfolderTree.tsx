import type { LibrarySubfolder } from "@librephotos/api-client";
import { ActionIcon, Badge, Checkbox, Group, Skeleton, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useLibrarySubfoldersQuery } from "../../api_client/user/hooks/useExcludedFolders";
import { ICON_SIZE } from "../../uiConstants";
import { ErrorState } from "../common/ErrorState";
import { useListFailure } from "../common/useListFailure";
import { isLeftOut, leftOutBelow } from "./excludedPaths";
import classes from "./SubfolderTree.module.css";

type TreeProps = Readonly<{
  /** The folder whose subfolders are listed. */
  path: string;
  /** The folders left out so far (the draft). */
  excluded: readonly string[];
  onToggle: (path: string) => void;
}>;

function FolderNode({ folder, excluded, onToggle }: Readonly<{ folder: LibrarySubfolder } & Omit<TreeProps, "path">>) {
  const { t } = useTranslation();
  const [expanded, { toggle }] = useDisclosure(false);
  const leftOut = isLeftOut(excluded, folder.path);
  const partly = !leftOut && leftOutBelow(excluded, folder.path).length > 0;
  const canExpand = folder.has_subfolders && !leftOut;
  return (
    <li>
      <Group gap={4} wrap="nowrap" className={classes.row}>
        {canExpand ? (
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            onClick={toggle}
            aria-expanded={expanded}
            aria-label={t("libraryfolders.showsubfolders", { name: folder.name })}
          >
            {expanded ? <IconChevronDown size={ICON_SIZE.menu} /> : <IconChevronRight size={ICON_SIZE.menu} />}
          </ActionIcon>
        ) : (
          <span className={classes.spacer} />
        )}
        <Checkbox
          size="xs"
          checked={!leftOut}
          indeterminate={partly}
          onChange={() => onToggle(folder.path)}
          label={
            <Text size="sm" span td={leftOut ? "line-through" : undefined} c={leftOut ? "dimmed" : undefined}>
              {folder.name}
            </Text>
          }
          className={classes.check}
        />
        {leftOut && (
          <Badge size="xs" variant="light" color="gray">
            {t("libraryfolders.leftout")}
          </Badge>
        )}
        <Text size="xs" c="dimmed" className={classes.count}>
          {folder.photo_count}
        </Text>
      </Group>
      {canExpand && expanded && <SubfolderTree path={folder.path} excluded={excluded} onToggle={onToggle} />}
    </li>
  );
}

/** The subfolders of a library folder with a checkbox each, loaded as they are opened (#791). */
export function SubfolderTree({ path, excluded, onToggle }: TreeProps) {
  const { t } = useTranslation();
  const query = useLibrarySubfoldersQuery(path, true);
  const failure = useListFailure(query);
  if (failure) return <ErrorState failure={failure} compact />;
  if (!query.data) return <Skeleton height={24} my={4} />;
  if (query.data.subfolders.length === 0) {
    return (
      <Text size="xs" c="dimmed" pl="lg">
        {t("libraryfolders.nosubfolders")}
      </Text>
    );
  }
  return (
    <ul className={classes.tree}>
      {query.data.subfolders.map(folder => (
        <FolderNode key={folder.path} folder={folder} excluded={excluded} onToggle={onToggle} />
      ))}
      {query.data.truncated && (
        <li>
          <Text size="xs" c="dimmed">
            {t("libraryfolders.truncated")}
          </Text>
        </li>
      )}
    </ul>
  );
}
