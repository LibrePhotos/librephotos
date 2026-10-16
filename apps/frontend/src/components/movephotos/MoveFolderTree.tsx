import type { LibraryFolder } from "@librephotos/api-client";
import { ActionIcon, Badge, Box, Loader, Text, UnstyledButton } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconChevronDown, IconChevronRight, IconFolder, IconFolderOpen, IconFolderPlus } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useMoveFoldersQuery } from "../../api_client/folders/hooks";
import { samePath } from "../../util/folderPaths";
import { ErrorState } from "../common/ErrorState";
import { useListFailure } from "../common/useListFailure";
import classes from "./MoveFolderTree.module.css";

/** A folder named in the dialog that does not exist yet: the move makes it. */
export type NewFolder = Readonly<{ parent: string; path: string; name: string }>;

type TreeProps = Readonly<{
  /** The folder picked, highlighted in the tree. */
  selected: string;
  onSelect: (path: string) => void;
  /** The folder the photos are in now, marked: moving there changes nothing. */
  currentFolder?: string;
  newFolders: readonly NewFolder[];
}>;

type NodeProps = TreeProps & Readonly<{ folder: LibraryFolder; level: number; isNew?: boolean }>;

const INDENT_PX = 16;
// The chevron's width plus the gap, so a note lines up with the folder names.
const NOTE_OFFSET_PX = 26;

function TreeNote({ level, color, children }: Readonly<{ level: number; color: string; children: React.ReactNode }>) {
  return (
    <li>
      <Text size="xs" c={color} pl={level * INDENT_PX + NOTE_OFFSET_PX} py={4}>
        {children}
      </Text>
    </li>
  );
}

function FolderChildren({ folder, level, ...tree }: NodeProps) {
  const { t } = useTranslation();
  const children = useMoveFoldersQuery(folder.path, folder.has_subfolders);
  const added = tree.newFolders.filter(created => samePath(created.parent, folder.path));
  const childLevel = level + 1;
  return (
    <ul role="group" className={classes.group}>
      {folder.has_subfolders && children.isPending && (
        <li>
          <Loader size="xs" ml={childLevel * INDENT_PX + NOTE_OFFSET_PX} my={4} />
        </li>
      )}
      {children.isError && (
        <TreeNote level={childLevel} color="red">
          {t("movephotos.listfailed")}
        </TreeNote>
      )}
      {/* At most MAX_LISTED_FOLDERS (500) a level: the server cuts the rest and says so. */}
      {children.data?.folders.map(child => (
        <FolderNode key={child.path} {...tree} folder={child} level={childLevel} />
      ))}
      {added.map(created => (
        <FolderNode
          key={created.path}
          {...tree}
          folder={{ name: created.name, path: created.path, has_subfolders: false }}
          level={childLevel}
          isNew
        />
      ))}
      {children.data?.truncated && (
        <TreeNote level={childLevel} color="dimmed">
          {t("movephotos.truncated")}
        </TreeNote>
      )}
    </ul>
  );
}

function FolderIcon({ open, isNew }: Readonly<{ open: boolean; isNew: boolean }>) {
  const color = "var(--mantine-color-yellow-7)";
  if (isNew) return <IconFolderPlus size={16} color={color} />;
  return open ? <IconFolderOpen size={16} color={color} /> : <IconFolder size={16} color={color} />;
}

function FolderNode(props: NodeProps) {
  const { t } = useTranslation();
  const { folder, level, selected, onSelect, currentFolder, newFolders, isNew = false } = props;
  const hasChildren = folder.has_subfolders || newFolders.some(created => samePath(created.parent, folder.path));
  // The library folders start open: the photos are below them.
  const [open, { toggle }] = useDisclosure(level === 0);
  const isSelected = samePath(folder.path, selected);
  const isCurrent = currentFolder !== undefined && samePath(folder.path, currentFolder);
  const toggleLabel = open
    ? t("movephotos.collapse", { name: folder.name })
    : t("movephotos.expand", { name: folder.name });
  return (
    <li
      role="treeitem"
      aria-level={level + 1}
      aria-selected={isSelected}
      aria-expanded={hasChildren ? open : undefined}
    >
      <Box className={classes.row} data-selected={isSelected || undefined} pl={level * INDENT_PX}>
        {hasChildren ? (
          <ActionIcon variant="subtle" color="gray" size={22} aria-label={toggleLabel} onClick={toggle}>
            {open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          </ActionIcon>
        ) : (
          <span className={classes.spacer} />
        )}
        <UnstyledButton className={classes.name} onClick={() => onSelect(folder.path)} title={folder.path}>
          <span className={classes.icon}>
            <FolderIcon open={open && hasChildren} isNew={isNew} />
          </span>
          <Text size="sm" truncate="end" fw={isSelected ? 600 : undefined} c={isCurrent ? "dimmed" : undefined}>
            {folder.name}
          </Text>
          {isCurrent && (
            <Badge size="xs" variant="light" color="gray">
              {t("movephotos.currentfolder")}
            </Badge>
          )}
          {isNew && (
            <Badge size="xs" variant="light">
              {t("movephotos.newbadge")}
            </Badge>
          )}
        </UnstyledButton>
      </Box>
      {open && hasChildren && <FolderChildren {...props} />}
    </li>
  );
}

/**
 * The folders of the user's own library a move can go to (#352): the scan directory and the upload
 * folder, read one level at a time as they are opened.
 */
export function MoveFolderTree(props: TreeProps) {
  const { t } = useTranslation();
  const roots = useMoveFoldersQuery(null);
  const failure = useListFailure(roots);
  if (failure) return <ErrorState failure={failure} compact />;
  if (!roots.data) return <Loader size="xs" />;
  if (roots.data.folders.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        {t("movephotos.nolibrary")}
      </Text>
    );
  }
  return (
    <ul role="tree" aria-label={t("movephotos.treelabel")} className={classes.group}>
      {roots.data.folders.map(root => (
        <FolderNode key={root.path} {...props} folder={root} level={0} />
      ))}
    </ul>
  );
}
