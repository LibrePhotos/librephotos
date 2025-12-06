import React, { useEffect, useMemo, useRef, useState } from "react";
import { Grid, Text, TextInput, Tree } from "@mantine/core";

import { useFetchDirsQuery } from "../../api_client/folders/hooks";
import type { DirTree } from "../../api_client/folders/types";
import { mergeDirTree } from "../../util/util";
import { Leaf } from "../modals/Leaf";

type DirectoryPickerProps = Readonly<{
  value: string;
  onChange: (path: string) => void;
  onValidityChange?: (isValid: boolean) => void;
  required?: boolean;
  placeholder?: string;
  label?: React.ReactNode;
  description?: React.ReactNode;
  treeHeight?: number;
  missingPathError?: string;
}>;

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

export function DirectoryPicker(props: DirectoryPickerProps) {
  const {
    value,
    onChange,
    onValidityChange,
    required,
    placeholder,
    label,
    description,
    treeHeight = 150,
    missingPathError = "Path does not exist",
  } = props;
  const inputRef = useRef<HTMLInputElement>(null);
  const [treeData, setTreeData] = useState<DirTree[]>([]);
  const [path, setPath] = useState(value);
  const { data: directoryTree } = useFetchDirsQuery(path);

  useEffect(() => {
    if (!directoryTree) {
      return;
    }
    setTreeData(prev => {
      if (prev.length === 0) {
        return directoryTree;
      }
      const tree = mergeDirTree(prev, directoryTree[0]);
      return [...tree];
    });
  }, [directoryTree]);

  useEffect(() => {
    if (value !== path) {
      setPath(value);
    }
  }, [value, path]);

  const convertTree = (data: DirTree[]): Array<{ value: string; label: string; children?: any[] }> =>
    data.map(item => ({
      value: item.absolute_path,
      label: item.title,
      children: item.children.length > 0 ? convertTree(item.children) : undefined,
    }));

  const mantineTreeData = useMemo(() => convertTree(treeData), [treeData]);

  const nodeClicked = (node: { value: string }) => {
    if (inputRef.current) {
      const scanDirectory = node.value;
      inputRef.current.value = scanDirectory;
      setPath(scanDirectory);
      onChange(scanDirectory);
    }
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

  return (
    <>
      <Grid grow>
        <Grid.Col span={9}>
          <TextInput
            label={label}
            ref={inputRef}
            required={required}
            placeholder={placeholder}
            name="scan_directory"
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
      {description}
      <Text size="sm" c="dimmed">
        {/* spacer to align with previous UI; keep description optional */}
      </Text>
      <div style={{ height: `${treeHeight}px`, overflow: "auto" }}>
        <Tree
          data={mantineTreeData}
          selectOnClick
          clearSelectionOnOutsideClick
          renderNode={payload => <Leaf {...payload} nodeClicked={nodeClicked} />}
        />
      </div>
    </>
  );
}

