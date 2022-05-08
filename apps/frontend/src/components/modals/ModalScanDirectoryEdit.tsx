import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Modal from "react-modal";
import SortableTree from "react-sortable-tree";
import FileExplorerTheme from "react-sortable-tree-theme-file-explorer";
import { Button, Header, Input } from "semantic-ui-react";

import { fetchDirectoryTree, manageUpdateUser, updateUserAndScan } from "../../actions/utilActions";
import { useAppDispatch, useAppSelector } from "../../store/store";

type Props = {
  isOpen: boolean;
  updateAndScan: boolean;
  userToEdit: any;
  selectedNodeId: string;
  onRequestClose: () => void;
};

const modalStyles = {
  content: {
    top: "12vh",
    left: "8vh",
    right: "8vh",
    height: "65vh",
    display: "flex",
    flexFlow: "column",
    overflow: "hidden",
    padding: 0,
    backgroundColor: "white",
  },
  overlay: {
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    position: "fixed",
    borderRadius: 0,
    border: 0,
    zIndex: 102,
    backgroundColor: "rgba(200,200,200,0.8)",
  },
};

export function ModalScanDirectoryEdit(props: Props) {
  const { isOpen, updateAndScan, userToEdit, selectedNodeId, onRequestClose } = props;

  const [newScanDirectory, setNewScanDirectory] = useState("");
  const [treeData, setTreeData] = useState([]);
  const [scanDirectoryPlaceholder, setScanDirectoryPlaceholder] = useState("");
  const dispatch = useAppDispatch();
  const auth = useAppSelector(state => state.auth);
  const { directoryTree } = useAppSelector(state => state.util);
  const inputRef = useRef<Input>(null);
  const { t } = useTranslation();

  useEffect(() => {
    if (auth.access && auth.access.is_admin) {
      dispatch(fetchDirectoryTree());
    }
  }, [auth.access, dispatch]);

  useEffect(() => {
    if (treeData.length === 0) {
      setTreeData(directoryTree);
    }
  }, [directoryTree, treeData]);

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

  const nodeClicked = (event, rowInfo) => {
    console.log(rowInfo);
    if (inputRef.current) {
      // @ts-ignore
      inputRef.current.value = rowInfo.node.absolute_path;
      setNewScanDirectory(rowInfo.node.absolute_path);
    }
  };

  return (
    <Modal
      ariaHideApp={false}
      isOpen={isOpen}
      onRequestClose={() => {
        onRequestClose();
        setNewScanDirectory("");
      }}
      // @ts-ignore
      style={modalStyles}
    >
      <div style={{ padding: 10 }}>
        <Header>
          <Header.Content>
            {t("modalscandirectoryedit.header")} &quot;{userToEdit ? userToEdit.username : "..."}&quot;
            <Header.Subheader>
              {t("modalscandirectoryedit.explanation1")} &quot;{userToEdit ? userToEdit.username : "..."}&quot;{" "}
              {t("modalscandirectoryedit.explanation2")}
            </Header.Subheader>
          </Header.Content>
        </Header>
      </div>
      <div style={{ padding: 10 }}>
        <Header as="h5">{t("modalscandirectoryedit.currentdirectory")}</Header>
      </div>
      <div style={{ padding: 7 }}>
        <Input ref={inputRef} type="text" placeholder={scanDirectoryPlaceholder} action fluid>
          <input />
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
        </Input>
      </div>
      <div style={{ padding: 10 }}>
        <Header as="h5">{t("modalscandirectoryedit.explanation3")}</Header>
      </div>
      <div
        style={{
          height: "100%",
          width: "100%",
          paddingLeft: 7,
          paddingTop: 7,
          paddingBottom: 7,
        }}
      >
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
