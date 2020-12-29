import moment from "moment";
import React, { Component } from "react";
import Modal from "react-modal";
import { connect } from "react-redux";
import SortableTree from "react-sortable-tree";
import FileExplorerTheme from "react-sortable-tree-theme-file-explorer";
import { Button, Grid, Header, Icon, Input, Loader, Table } from "semantic-ui-react";
import { fetchDirectoryTree, fetchUserList, manageUpdateUser} from "../actions/utilActions";




const modalStyles = {
  content: {
    top: 150,
    left: 40,
    right: 40,
    height: window.innerHeight - 300,

    overflow: "hidden",
    // paddingRight:0,
    // paddingBottomt:0,
    // paddingLeft:10,
    // paddingTop:10,
    padding: 0,
    backgroundColor: "white"
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
    backgroundColor: "rgba(200,200,200,0.8)"
  }
};

export class UserManagement extends Component {
  state = { modalOpen: false, userToEdit: null };

  componentDidMount() {
    if (this.props.auth.access.is_admin) {
      this.props.dispatch(fetchUserList());
      this.props.dispatch(fetchDirectoryTree());
    }
  }

  render() {
    if (!this.props.auth.access.is_admin) {
      return <div>You have no access</div>;
    }
    if (this.props.fetching) {
      return (
        <div>
          <Loader active />
        </div>
      );
    }
    return (
      <div style={{padding:10}}>
        <Header>User Management</Header>
        <div>
          <Table compact selectable celled striped>
            <Table.Header>
              <Table.HeaderCell>Username</Table.HeaderCell>
              <Table.HeaderCell>Scan Directory</Table.HeaderCell>
              <Table.HeaderCell>Photo Count</Table.HeaderCell>
              <!-- Changed Last Login due to well no last login kept in DB -->
              <Table.HeaderCell>Joined</Table.HeaderCell>
            </Table.Header>
            <Table.Body>
              {this.props.userList.map(user => {
                return (
                  <Table.Row>
                    <Table.Cell>{user.username}</Table.Cell>
                    <Table.Cell warning={!user.scan_directory}>
                      <Icon
                        name="edit"
                        onClick={() => {
                          this.setState({
                            userToEdit: user,
                            modalOpen: true
                          });
                        }}
                      />
                      {user.scan_directory ? user.scan_directory : "Not set"}
                    </Table.Cell>
                    <Table.Cell>{user.photo_count}</Table.Cell>
                    <Table.Cell>
                      {moment(user.date_joined).fromNow()}
                    </Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table>
        </div>
        <ModalScanDirectoryEdit
          onRequestClose={() => {
            this.setState({ modalOpen: false });
          }}
          userToEdit={this.state.userToEdit}
          isOpen={this.state.modalOpen}
        />
      </div>
    );
  }
}

class ModalScanDirectoryEdit extends Component {
  constructor(props) {
    super(props);
    this.state = { newScanDirectory: "", treeData: [] };
    this.nodeClicked = this.nodeClicked.bind(this);
    this.inputRef = React.createRef();
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
    this.inputRef.current.inputRef.value = rowInfo.node.absolute_path;
    this.setState({ newScanDirectory: rowInfo.node.absolute_path });
  }

  render() {
    console.log(this.inputRef);
    return (
      <Modal
        ariaHideApp={false}
        isOpen={this.props.isOpen}
        onRequestClose={() => {
          this.props.onRequestClose();
          this.setState({ newScanDirectory: "" });
        }}
        style={modalStyles}
      >
        <div style={{ padding: 10 }}>
          <Header as="h3">
            Set the scan directory for user "{this.props.userToEdit
              ? this.props.userToEdit.username
              : "..."}"
            <Header.Subheader>
              When the user "{this.props.userToEdit
                ? this.props.userToEdit.username
                : "..."}" clicks on the 'scan photos' button, photos in the
              directory that you specify here will be imported under the user's
              account.
            </Header.Subheader>
          </Header>
        </div>
        <Grid>
          <Grid.Row>
            <Grid.Column>
              <div style={{ padding: 10 }}>
                <Header as="h5">User's current directory</Header>
              </div>
              <div style={{ padding: 7 }}>
                <Input
                  ref={this.inputRef}
                  type="text"
                  placeholder={
                    this.props.userToEdit
                      ? this.props.userToEdit.scan_directory === ""
                        ? "not set"
                        : this.props.userToEdit.scan_directory
                      : "..."
                  }
                  action
                  fluid
                >
                  <input />
                  <Button
                    type="submit"
                    color="green"
                    onClick={() => {
                      const newUserData = {
                        ...this.props.userToEdit,
                        scan_directory: this.state.newScanDirectory
                      };
                      console.log(newUserData);
                      this.props.dispatch(manageUpdateUser(newUserData));
                      this.props.onRequestClose()
                    }}
                  >
                    Update
                  </Button>
                </Input>
              </div>
            </Grid.Column>
          </Grid.Row>
          <Grid.Row>
            <Grid.Column>
              <div style={{ padding: 10 }}>
                <Header as="h5">Choose a directory from below</Header>
              </div>
              <div
                style={{
                  height: 300,
                  width: "100%",
                  paddingLeft: 7,
                  paddingTop: 7,
                  paddingBottom: 7
                }}
              >
                <SortableTree
                  innerStyle={{ outline: "none" }}
                  canDrag={() => false}
                  canDrop={() => false}
                  treeData={this.state.treeData}
                  onChange={treeData => this.setState({ treeData })}
                  theme={FileExplorerTheme}
                  generateNodeProps={rowInfo => {
                    let nodeProps = {
                      onClick: event => this.nodeClicked(event, rowInfo)
                    };
                    if (this.state.selectedNodeId === rowInfo.node.id) {
                      nodeProps.className = "selected-node";
                    }
                    return nodeProps;
                  }}
                />
              </div>
            </Grid.Column>
          </Grid.Row>
        </Grid>
      </Modal>
    );
  }
}

UserManagement = connect(store => {
  return {
    auth: store.auth,

    userList: store.util.userList,
    fetchingUSerList: store.util.fetchingUserList,
    fetchedUserList: store.util.fetchedUserList
  };
})(UserManagement);

ModalScanDirectoryEdit = connect(store => {
  return {
    auth: store.auth,

    directoryTree: store.util.directoryTree,
    fetchingDirectoryTree: store.util.fetchingDirectoryTree,
    fetchedDirectoryTree: store.util.fetchedDirectoryTree,

    userList: store.util.userList,
    fetchingUSerList: store.util.fetchingUserList,
    fetchedUserList: store.util.fetchedUserList
  };
})(ModalScanDirectoryEdit);
