import { Button, Divider, Grid, Modal, Stack, TextInput, Title, Tree } from "@mantine/core";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchNextcloudDirsQuery } from "../../api_client/folders/hooks/useFetchNextcloudDirsQuery";
import type { DirTree, DirTreeResponse } from "../../api_client/folders/types";
import { Leaf } from "./Leaf";

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

  // Convert DirTree data to the format expected by Mantine Tree
  const convertToMantineTreeData = (data: DirTree[]) =>
    data.map(item => ({
      value: item.absolute_path,
      label: item.title,
      children: item.children.length > 0 ? convertToMantineTreeData(item.children) : undefined,
    }));

  const treeItems = convertToMantineTreeData(treeData);

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
          <Tree
            data={treeItems}
            selectOnClick
            clearSelectionOnOutsideClick
            onClick={node => {
              if (inputRef.current) {
                inputRef.current.value = node.value;
              }
              setNewScanDirectory(node.value);
            }}
            renderNode={payload => <Leaf {...payload} />}
          />
        </div>
      </Stack>
    </Modal>
  );
}
