import React, { Component } from "react";
import { compose } from "redux";
import { Header, Input, Button } from "semantic-ui-react";
import { connect } from "react-redux";
import Modal from "react-modal";
import { manageUpdateUser, updateUserAndScan } from "../../actions/utilActions";
import SortableTree from "react-sortable-tree";
import FileExplorerTheme from "react-sortable-tree-theme-file-explorer";
import { withTranslation } from "react-i18next";
import { fetchDirectoryTree } from "../../actions/utilActions";
export class ModalScanDirectoryEdit extends Component {
  constructor(props) {
    super(props);
    this.state = {
      updateAndScan: false,
      newScanDirectory: "",
      treeData: [],
      newConfidence: "",
    };
    this.nodeClicked = this.nodeClicked.bind(this);
    this.inputRef = React.createRef();
  }

  componentDidMount() {
    if (this.props.updateAndScan) {
      this.setState({ updateAndScan: this.props.updateAndScan });
    }
    if (this.props.auth.access && this.props.auth.access.is_admin) {
      this.props.dispatch(fetchDirectoryTree());
    }
  }

  static getDerivedStateFromProps(nextProps, prevState) {
    if (prevState.treeData.length === 0) {
      return { ...prevState, treeData: nextProps.directoryTree };
    } else {
      return prevState;
    }
  }

  nodeClicked(event, rowInfo) {
    console.log(rowInfo);
    this.inputRef.current.value = rowInfo.node.absolute_path;
    this.setState({ newScanDirectory: rowInfo.node.absolute_path });
  }

  render() {
    return (
      <Modal
        ariaHideApp={false}
        isOpen={this.props.isOpen}
        onRequestClose={() => {
          this.props.onRequestClose();
          this.setState({ newScanDirectory: "", newConfidence: "" });
        }}
        style={modalStyles}
      >
        <div style={{ padding: 10 }}>
          <Header>
            <Header.Content>
              {this.props.t("modalscandirectoryedit.header")} "
              {this.props.userToEdit ? this.props.userToEdit.username : "..."}"
              <Header.Subheader>
                {this.props.t("modalscandirectoryedit.explanation1")} "
                {this.props.userToEdit ? this.props.userToEdit.username : "..."}
                " {this.props.t("modalscandirectoryedit.explanation2")}
              </Header.Subheader>
            </Header.Content>
          </Header>
        </div>
        <div style={{ padding: 10 }}>
          <Header as="h5">
            {this.props.t("modalscandirectoryedit.currentdirectory")}
          </Header>
        </div>
        <div style={{ padding: 7 }}>
          <Input
            ref={this.inputRef}
            type="text"
            placeholder={
              this.state.newScanDirectory === ""
                ? this.props.userToEdit
                  ? this.props.userToEdit.scan_directory === ""
                    ? this.props.t("modalscandirectoryedit.notset")
                    : this.props.userToEdit.scan_directory
                  : this.props.t("modalscandirectoryedit.notset")
                : this.state.newScanDirectory
            }
            action
            fluid
          >
            <input />
            {this.state.updateAndScan ? (
              <Button
                type="submit"
                color="green"
                onClick={() => {
                  if (this.state.newScanDirectory === "") {
                    this.setState({
                      newScanDirectory: this.props.userToEdit.scan_directory,
                    });
                  }
                  const newUserData = {
                    ...this.props.userToEdit,
                    scan_directory: this.state.newScanDirectory,
                  };
                  console.log(newUserData);
                  this.props.dispatch(updateUserAndScan(newUserData));
                  this.props.onRequestClose();
                }}
              >
                {this.props.t("scan")}
              </Button>
            ) : (
              <Button
                type="submit"
                color="green"
                onClick={() => {
                  if (this.state.newScanDirectory === "") {
                    this.setState({
                      newScanDirectory: this.props.userToEdit.scan_directory,
                    });
                  }
                  const newUserData = {
                    ...this.props.userToEdit,
                    scan_directory: this.state.newScanDirectory,
                  };
                  console.log(newUserData);
                  this.props.dispatch(manageUpdateUser(newUserData));
                  this.props.onRequestClose();
                }}
              >
                {this.props.t("modalscandirectoryedit.update")}
              </Button>
            )}
          </Input>
        </div>
        <div style={{ padding: 10 }}>
          <Header as="h5">
            {this.props.t("modalscandirectoryedit.explanation3")}
          </Header>
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
            treeData={this.state.treeData}
            onChange={(treeData) => this.setState({ treeData })}
            theme={FileExplorerTheme}
            generateNodeProps={(rowInfo) => {
              let nodeProps = {
                onClick: (event) => this.nodeClicked(event, rowInfo),
              };
              if (this.state.selectedNodeId === rowInfo.node.id) {
                nodeProps.className = "selected-node";
              }
              return nodeProps;
            }}
          />
        </div>
      </Modal>
    );
  }
}

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

ModalScanDirectoryEdit = compose(
  connect((store) => {
    return {
      auth: store.auth,

      directoryTree: store.util.directoryTree,
      fetchingDirectoryTree: store.util.fetchingDirectoryTree,
      fetchedDirectoryTree: store.util.fetchedDirectoryTree,

      userList: store.util.userList,
      fetchingUSerList: store.util.fetchingUserList,
      fetchedUserList: store.util.fetchedUserList,
    };
  }),
  withTranslation()
)(ModalScanDirectoryEdit);
