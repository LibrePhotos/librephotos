import React, { useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import Modal from "react-modal";
import SortableTree from "react-sortable-tree";
import FileExplorerTheme from "react-sortable-tree-theme-file-explorer";
import { Button, Divider, Header, Input } from "semantic-ui-react";

import { fetchNextcloudDirectoryTree, updateUser } from "../../actions/utilActions";
import { useAppDispatch, useAppSelector } from "../../store/store";

const modalStyles = {
  content: {
    top: 50,
    left: 50,
    right: 50,
    height: window.innerHeight - 100,

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

type Props = {
  isOpen: boolean;
  userToEdit: any;
  selectedNodeId?: string;
  onRequestClose: () => void;
};

export const ModalNextcloudScanDirectoryEdit = (props: Props) => {
  const { t } = useTranslation();
  const [newScanDirectory, setNewScanDirectory] = useState("");
  const [treeData, setTreeData] = useState([]);

  const inputRef = useRef<Input>();
  const auth = useAppSelector(state => state.auth);
  const dispatch = useAppDispatch();
  const { nextcloudDirectoryTree } = useAppSelector(state => state.util);

  useEffect(() => {
    setTreeData(nextcloudDirectoryTree);
  }, [nextcloudDirectoryTree]);

  const nodeClicked = (event, rowInfo) => {
    //@ts-ignore
    inputRef.current.inputRef.value = rowInfo.node.absolute_path;
    setNewScanDirectory(rowInfo.node.absolute_path);
  };

  return (
    <Modal
      ariaHideApp={false}
      isOpen={props.isOpen}
      onRequestClose={() => {
        props.onRequestClose();
        setNewScanDirectory("");
      }}
      //@ts-ignore
      style={modalStyles}
      onAfterOpen={() => {
        dispatch(fetchNextcloudDirectoryTree("/"));
      }}
    >
      <div style={{ padding: 10 }}>
        <Header as="h3">
          <Trans i18nKey="modalnextcloud.setdirectory">Set your Nextcloud scan directory</Trans>
        </Header>
      </div>
      <div style={{ padding: 10 }}>
        <Header as="h5">
          <Trans i18nKey="modalnextcloud.currentdirectory">Current Nextcloud scan directory</Trans>
        </Header>
      </div>
      <div style={{ padding: 7 }}>
        <Input
          //@ts-ignore
          ref={inputRef}
          type="text"
          placeholder={
            props.userToEdit
              ? props.userToEdit.nextcloud_scan_directory === ""
                ? t("modalnextcloud.notset")
                : props.userToEdit.nextcloud_scan_directory
              : "..."
          }
          action
          fluid
        >
          <input value={newScanDirectory} />
          <Button
            type="submit"
            color="green"
            onClick={() => {
              const newUserData = {
                ...props.userToEdit,
                nextcloud_scan_directory: newScanDirectory,
              };
              const ud = newUserData;
              updateUser(ud, dispatch);
              props.onRequestClose();
            }}
          >
            <Trans i18nKey="modalnextcloud.update">Update</Trans>
          </Button>
          <Button
            onClick={() => {
              props.onRequestClose();
            }}
          >
            <Trans i18nKey="modalnextcloud.cancel">Cancel</Trans>
          </Button>
        </Input>
      </div>
      <Divider />
      <div style={{ paddingLeft: 10 }}>
        <Header as="h5">
          <Trans i18nKey="modalnextcloud.choosedirectory">Choose a directory from below</Trans>
        </Header>
      </div>
      <div
        style={{
          height: window.innerHeight - 100 - 40.44 - 36 - 52 - 30 - 10,
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
          onChange={treeData => setTreeData(treeData)}
          theme={FileExplorerTheme}
          generateNodeProps={rowInfo => {
            const nodeProps = {
              onClick: event => nodeClicked(event, rowInfo),
            };
            if (props.selectedNodeId === rowInfo.node.id) {
              //@ts-ignore
              nodeProps.className = "selected-node";
            }
            return nodeProps;
          }}
        />
      </div>
    </Modal>
  );
};
