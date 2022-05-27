import { Button, Grid, Modal, Space, Text, TextInput, Title } from "@mantine/core";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import SortableTree from "react-sortable-tree";
import FileExplorerTheme from "react-sortable-tree-theme-file-explorer";

import { fetchDirectoryTree, manageUpdateUser, updateUserAndScan } from "../../actions/utilActions";
import { useAppDispatch, useAppSelector } from "../../store/store";

type Props = {
  isOpen: boolean;
  updateAndScan?: boolean;
  userToEdit: any;
  selectedNodeId?: string;
  onRequestClose: () => void;
};

export function ModalScanDirectoryEdit(props: Props) {
  const { isOpen, updateAndScan, userToEdit, selectedNodeId, onRequestClose } = props;
  const [newScanDirectory, setNewScanDirectory] = useState("");
  const [treeData, setTreeData] = useState([]);
  const [scanDirectoryPlaceholder, setScanDirectoryPlaceholder] = useState("");
  const dispatch = useAppDispatch();
  const auth = useAppSelector(state => state.auth);
  const { directoryTree } = useAppSelector(state => state.util);
  const inputRef = useRef<HTMLInputElement>(null);
  const { t } = useTranslation();

  useEffect(() => {
    if (auth.access && auth.access.is_admin) {
      dispatch(fetchDirectoryTree(""));
    }
  }, [auth.access, dispatch]);

  useEffect(() => {
    if (treeData.length === 0) {
      setTreeData(directoryTree);
    } else {
      const newData = replacePath(treeData, directoryTree[0]);
      console.log(newData);
      // @ts-ignore
      setTreeData([...newData]);
    }
  }, [directoryTree]);

  useEffect(() => {
    if (newScanDirectory) {
      setScanDirectoryPlaceholder(newScanDirectory);
      return;
    }
    if (userToEdit && userToEdit.scan_directory) {
      setScanDirectoryPlaceholder(userToEdit.scan_directory);
      return;
    }
    setScanDirectoryPlaceholder(t("modalscandirectoryedit.notset"));
  }, [newScanDirectory, userToEdit, t]);

  const replacePath = (treeData, newData) => {
    const path = newData.absolute_path;
    treeData.map(folder => {
      if (path === folder.absolute_path) {
        folder.children = newData.children;
        return folder;
      }
      if (path.startsWith(folder.absolute_path)) {
        const newTreeData = replacePath(folder.children, newData);
        folder.children = newTreeData;
        return folder;
      }
      return folder;
    });
    return treeData;
  };

  const nodeClicked = (event, rowInfo) => {
    if (inputRef.current) {
      const path = rowInfo.node.absolute_path;
      inputRef.current.value = path;
      dispatch(fetchDirectoryTree(path));
      setNewScanDirectory(path);
    }
  };

  return (
    <Modal
      opened={isOpen}
      centered
      onClose={() => {
        onRequestClose();
        setNewScanDirectory("");
      }}
      title={
        <Title order={4}>{`${t("modalscandirectoryedit.header")} "${userToEdit ? userToEdit.username : "..."}"`}</Title>
      }
      size="xl"
    >
      <Text size="sm" color="dimmed">
        {t("modalscandirectoryedit.explanation1")} &quot;{userToEdit ? userToEdit.username : "..."}&quot;{" "}
        {t("modalscandirectoryedit.explanation2")}
      </Text>
      <Space h="md" />
      <Title order={6}>{t("modalscandirectoryedit.currentdirectory")} </Title>
      <Grid grow>
        <Grid.Col span={9}>
          <TextInput ref={inputRef} placeholder={scanDirectoryPlaceholder} />
        </Grid.Col>
        <Grid.Col span={3}>
          {updateAndScan ? (
            <Button
              type="submit"
              color="green"
              onClick={() => {
                if (newScanDirectory === "") {
                  setNewScanDirectory(userToEdit.scan_directory);
                }
                const newUserData = {
                  ...userToEdit,
                  scan_directory: newScanDirectory,
                };
                console.log(newUserData);
                dispatch(updateUserAndScan(newUserData));
                onRequestClose();
              }}
            >
              {t("scan")}
            </Button>
          ) : (
            <Button
              type="submit"
              color="green"
              onClick={() => {
                if (newScanDirectory === "") {
                  setNewScanDirectory(userToEdit.scan_directory);
                }
                const newUserData = {
                  ...userToEdit,
                  scan_directory: newScanDirectory,
                };
                console.log(newUserData);
                dispatch(manageUpdateUser(newUserData));
                onRequestClose();
              }}
            >
              {t("modalscandirectoryedit.update")}
            </Button>
          )}
        </Grid.Col>
      </Grid>
      <Title order={6}>{t("modalscandirectoryedit.explanation3")}</Title>
      <div style={{ height: "250px", overflow: "auto" }}>
        <SortableTree
          innerStyle={{ outline: "none" }}
          canDrag={() => false}
          canDrop={() => false}
          treeData={treeData}
          onChange={changedTreeData => setTreeData(changedTreeData)}
          theme={FileExplorerTheme}
          generateNodeProps={rowInfo => {
            const nodeProps = {
              onClick: event => nodeClicked(event, rowInfo),
            };
            if (selectedNodeId === rowInfo.node.id) {
              // @ts-ignore
              nodeProps.className = "selected-node";
            }
            return nodeProps;
          }}
        />
      </div>
    </Modal>
  );
}
