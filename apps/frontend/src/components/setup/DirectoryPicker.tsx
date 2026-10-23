import type { CreatedFolder, DirTree } from "@librephotos/api-client";
import { Box, Button, Grid, Group, Paper, Text, TextInput, Tree, type TreeNodeData } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconFolderPlus } from "@tabler/icons-react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchDirsQuery } from "../../api_client/folders/hooks";
import { mergeDirTree } from "../../util/util";
import { DisabledReason } from "../common/DisabledReason";
import { Leaf } from "../modals/Leaf";
import { NewFolderRow } from "./NewFolderRow";

type DirectoryPickerProps = Readonly<{
  value: string;
  onChange: (path: string) => void;
  onValidityChange?: (isValid: boolean) => void;
  required?: boolean;
  placeholder?: string;
  label?: React.ReactNode;
  /** Shown right under the input, above the folder tree. */
  hint?: React.ReactNode;
  description?: React.ReactNode;
  /** Form field name; give each picker on a page its own. */
  name?: string;
  treeHeight?: number;
  missingPathError?: string;
}>;

const convertTree = (data: DirTree[]): TreeNodeData[] =>
  data.map(item => ({
    value: item.absolute_path,
    label: item.title,
    children: item.children.length > 0 ? convertTree(item.children) : undefined,
  }));

const findPath = (tree: DirTree[], path: string): boolean => {
  let result = false;
  tree.forEach(folder => {
    if (path === folder.absolute_path) {
      result = result || true;
    }
    if (path.startsWith(folder.absolute_path)) {
      const resultChildren = findPath(folder.children, path);
      result = result || resultChildren;
    }
    return result || false;
  });
  return result;
};

/**
 * Where New folder puts the folder (#2035): the chosen folder, or the top of the tree while none is
 * typed. Null while the typed path is not a folder in the tree, or the tree has not loaded.
 */
export function newFolderParent(value: string, isValidPath: boolean, tree: readonly DirTree[]): string | null {
  if (value) {
    return isValidPath ? value : null;
  }
  return tree[0]?.absolute_path ?? null;
}

function NewFolderButton({ parent, onClick }: Readonly<{ parent: string | null; onClick: () => void }>) {
  const { t } = useTranslation();
  return (
    <DisabledReason reason={parent === null && t("directorypicker.choosefolderfirst")}>
      <Button variant="subtle" size="compact-sm" leftSection={<IconFolderPlus size={14} />} onClick={onClick}>
        {t("directorypicker.newfolder")}
      </Button>
    </DisabledReason>
  );
}

export function DirectoryPicker(props: DirectoryPickerProps) {
  const {
    value,
    onChange,
    onValidityChange,
    required,
    placeholder,
    label,
    hint,
    description,
    name = "scan_directory",
    treeHeight = 150,
    missingPathError = "Path does not exist",
  } = props;
  const inputRef = useRef<HTMLInputElement>(null);
  const [treeData, setTreeData] = useState<DirTree[]>([]);
  const [path, setPath] = useState(value);
  const { data: directoryTree } = useFetchDirsQuery(path);
  const [creating, { open: startCreating, close: stopCreating }] = useDisclosure(false);

  useEffect(() => {
    if (!directoryTree) {
      return;
    }
    setTreeData(prev => {
      if (prev.length === 0) {
        return directoryTree;
      }
      const branch = directoryTree[0];
      if (branch === undefined) {
        return prev;
      }
      const tree = mergeDirTree(prev, branch);
      return [...tree];
    });
  }, [directoryTree]);

  useEffect(() => {
    if (value !== path) {
      setPath(value);
    }
  }, [value, path]);

  const mantineTreeData = useMemo(() => convertTree(treeData), [treeData]);

  const choose = (folder: string) => {
    if (inputRef.current) {
      inputRef.current.value = folder;
      setPath(folder);
      onChange(folder);
    }
  };
  const nodeClicked = (node: { value: string }) => choose(node.value);

  // The parent comes back listed again with the new folder in it; then the new folder is chosen.
  const folderCreated = (folder: CreatedFolder) => {
    setTreeData(prev => mergeDirTree(prev, folder.parent));
    choose(folder.absolute_path);
    stopCreating();
  };

  const isValidPath = useMemo(() => {
    if (!value) {
      return true;
    }
    if (treeData.length === 0) {
      return true;
    }
    return findPath(treeData, value);
  }, [treeData, value]);

  useEffect(() => {
    if (onValidityChange) {
      onValidityChange(isValidPath);
    }
  }, [isValidPath, onValidityChange]);

  const parentForNew = newFolderParent(value, isValidPath, treeData);

  return (
    <>
      <Grid grow>
        <Grid.Col span={9}>
          <TextInput
            label={label}
            ref={inputRef}
            required={required}
            placeholder={placeholder}
            name={name}
            value={value}
            onChange={event => {
              const nextPath = event.currentTarget.value;
              onChange(nextPath);
              setPath(nextPath);
            }}
            error={
              value && !isValidPath ? (
                <Text component="span" c="red">
                  {missingPathError}
                </Text>
              ) : undefined
            }
          />
        </Grid.Col>
      </Grid>
      {hint}
      {/* A long description wraps; the button keeps its width. */}
      <Group justify="space-between" align="flex-end" wrap="nowrap" gap="xs">
        <Box flex={1} miw={0}>
          {description}
        </Box>
        <Box flex="none">
          <NewFolderButton parent={parentForNew} onClick={startCreating} />
        </Box>
      </Group>
      {/* Grows with the expanded folders up to treeHeight instead of reserving
          it: the tree starts as a single row. The border shows it is a list. */}
      <Paper withBorder radius="sm" p={4} mt={4} mah={treeHeight} style={{ overflow: "auto" }}>
        {creating && parentForNew !== null && (
          <NewFolderRow parent={parentForNew} onCreated={folderCreated} onCancel={stopCreating} />
        )}
        <Tree
          data={mantineTreeData}
          selectOnClick
          clearSelectionOnOutsideClick
          renderNode={payload => <Leaf {...payload} nodeClicked={nodeClicked} />}
        />
      </Paper>
    </>
  );
}
