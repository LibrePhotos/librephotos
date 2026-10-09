import { Button, Group, Modal, Paper, Stack, Text, TextInput, Tree, type TreeNodeData } from "@mantine/core";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchNextcloudDirsQuery } from "../../api_client/folders/hooks/useFetchNextcloudDirsQuery";
import type { DirTree, DirTreeResponse } from "../../api_client/folders/types";
import { Leaf } from "./Leaf";
import { modalTitleStyles } from "./modalTitleStyles";

type Props = Readonly<{
  /** The saved folder; unset until the user picked one. */
  path: string | null | undefined;
  isOpen: boolean;
  onChange: (dir: string) => void;
  onClose: () => void;
}>;

export function ModalNextcloudScanDirectoryEdit(props: Props) {
  const { t } = useTranslation();
  const { path, isOpen, onChange, onClose } = props;
  const [newScanDirectory, setNewScanDirectory] = useState(path ?? "");
  const [treeData, setTreeData] = useState<DirTreeResponse>([]);
  const { data: nextcloudDirs } = useFetchNextcloudDirsQuery();

  useEffect(() => {
    if (nextcloudDirs) {
      setTreeData(nextcloudDirs);
    }
  }, [nextcloudDirs]);

  // Start from the saved folder each time the dialog opens.
  useEffect(() => {
    if (isOpen) {
      setNewScanDirectory(path ?? "");
    }
  }, [isOpen, path]);

  // Convert DirTree data to the format expected by Mantine Tree
  const convertToMantineTreeData = (data: DirTree[]): TreeNodeData[] =>
    data.map(item => ({
      value: item.absolute_path,
      label: item.title,
      children: item.children.length > 0 ? convertToMantineTreeData(item.children) : undefined,
    }));

  const treeItems = convertToMantineTreeData(treeData);
  const trimmed = newScanDirectory.trim();

  return (
    <Modal
      styles={modalTitleStyles}
      opened={isOpen}
      centered
      onClose={onClose}
      title={t("modalnextcloud.setdirectory")}
      size="xl"
    >
      <Stack>
        <TextInput
          label={t("modalnextcloud.currentdirectory")}
          placeholder={t("modalnextcloud.notset")}
          value={newScanDirectory}
          onChange={event => setNewScanDirectory(event.currentTarget.value)}
        />
        <div>
          <Text size="sm" c="dimmed" mb={4}>
            {t("modalnextcloud.choosedirectory")}
          </Text>
          <Paper withBorder radius="sm" p={4} mah={250} style={{ overflow: "auto" }}>
            {/* Mantine's Tree has no per-node click handler: the Leaf reports the
                clicked folder (Tree's own onClick receives the <ul> click event). */}
            <Tree
              data={treeItems}
              selectOnClick
              clearSelectionOnOutsideClick
              renderNode={payload => <Leaf {...payload} nodeClicked={node => setNewScanDirectory(node.value)} />}
            />
          </Paper>
        </div>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("modalnextcloud.cancel")}
          </Button>
          <Button
            disabled={!trimmed || trimmed === (path ?? "")}
            onClick={() => {
              onChange(trimmed);
              onClose();
            }}
          >
            {t("modalnextcloud.update")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
