import { Button, Divider, Grid, Modal, Stack, TextInput, Title } from "@mantine/core";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import SortableTree from "react-sortable-tree";
import FileExplorerTheme from "react-sortable-tree-theme-file-explorer";

import type { DirTreeResponse } from "../../api_client/dir-tree";
import { useFetchNextcloudDirsQuery } from "../../api_client/nextcloud";

type Props = Readonly<{
  path: string;
  isOpen: boolean;
  onChange: (dir: string) => void;
  onClose: () => void;
}>;

export function ModalNextcloudScanDirectoryEdit(props: Props) {
  const { t } = useTranslation();
  const { path, isOpen, onChange, onClose } = props;
  const [newScanDirectory, setNewScanDirectory] = useState("");
  const [treeData, setTreeData] = useState<DirTreeResponse>([]);
  const [placeholder, setPlaceholder] = useState("...");
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: nextcloudDirs } = useFetchNextcloudDirsQuery();

  useEffect(() => {
    if (nextcloudDirs) {
      setTreeData(nextcloudDirs);
    }
  }, [nextcloudDirs]);

  useEffect(() => {
    setPlaceholder(path || t("modalnextcloud.notset"));
  }, [path, t]);

  const nodeClicked = (rowInfo: any) => {
    inputRef.current!.value = rowInfo.node.absolute_path;
    setNewScanDirectory(rowInfo.node.absolute_path);
  };

  return (
    <Modal
      opened={isOpen}
      centered
      onClose={onClose}
      title={<Title order={4}>{t("modalnextcloud.setdirectory")}</Title>}
      size="xl"
    >
      <Stack>
        <Title order={5}>{t("modalnextcloud.currentdirectory")}</Title>
        <Grid grow>
          <Grid.Col span={9}>
            <TextInput ref={inputRef} placeholder={placeholder} />
          </Grid.Col>
          <Grid.Col span={3}>
            <Button
              type="submit"
              color="green"
              onClick={() => {
                onChange(newScanDirectory);
                onClose();
              }}
            >
              {t("modalnextcloud.update")}
            </Button>
          </Grid.Col>
        </Grid>
        <Divider />
        <Title order={5}>{t("modalnextcloud.choosedirectory")}</Title>
        <div style={{ height: "250px", overflow: "auto" }}>
          <SortableTree
            innerStyle={{ outline: "none" }}
            canDrag={() => false}
            canDrop={() => false}
            treeData={treeData}
            onChange={setTreeData}
            theme={FileExplorerTheme}
            isVirtualized={false}
            generateNodeProps={(rowInfo: any) => {
              const nodeProps = {
                onClick: () => nodeClicked(rowInfo),
              };
              if (path === rowInfo.node.absolute_path) {
                Object.defineProperty(nodeProps, "className", { value: "selected-node" });
              }
              return nodeProps;
            }}
          />
        </div>
      </Stack>
    </Modal>
  );
}
