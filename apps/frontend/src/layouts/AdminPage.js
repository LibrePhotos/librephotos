import React, { Component } from 'react';
import {
  Form,
  Radio,
  Progress,
  Grid,
  Icon,
  Header,
  Input,
  Button,
  Loader,
  Table,
  Popup,
  Divider,
  Pagination,
} from 'semantic-ui-react';
import { connect } from 'react-redux';
import Modal from 'react-modal';
import moment from 'moment';
import {
  setSiteSettings,
  fetchSiteSettings,
  fetchJobList,
  deleteJob,
  fetchUserList,
  fetchDirectoryTree,
  manageUpdateUser,
} from '../actions/utilActions';
import SortableTree from 'react-sortable-tree';
import FileExplorerTheme from 'react-sortable-tree-theme-file-explorer';


export class AdminPage extends Component {
  state = {modalOpen: false, userToEdit: null};

  componentDidMount() {
    if (this.props.auth.access.is_admin) {
      this.props.dispatch(fetchSiteSettings());
      this.props.dispatch(fetchJobList());
      this.props.dispatch(fetchUserList());
      this.props.dispatch(fetchDirectoryTree());
    }
  }

  render() {
    if (!this.props.auth.access.is_admin) {
      return <div>Unauthorized</div>;
    }

    if (this.props.userSelfDetails.square_avatar) {
      var avatarImgSrc = this.props.userSelfDetails.square_avatar;
    } else if (this.state.avatarImgSrc) {
      var avatarImgSrc = this.state.avatarImgSrc;
    } else {
      var avatarImgSrc = '/unknown_user.jpg';
    }

    var buttonsDisabled = !this.props.workerAvailability;

    return (
      <div style={{padding: 10}}>
        <Header as="h2">
          <Icon name="wrench" />
          <Header.Content>Admin Area</Header.Content>
        </Header>

        <Divider />
        <Header as="h3">Site settings</Header>

        <Grid>
          <Grid.Row>
            <Grid.Column width={4} textAlign="left">
              <b>Allow user registration</b>
            </Grid.Column>
            <Grid.Column width={12}>
              <Form>
                <Form.Group>
                  <Form.Field>
                    <Radio
                      label="Allow"
                      name="radioGroup"
                      onChange={() =>
                        this.props.dispatch(
                          setSiteSettings({allow_registration: true}),
                        )
                      }
                      checked={this.props.siteSettings.allow_registration}
                    />
                  </Form.Field>
                  <Form.Field>
                    <Radio
                      label="Do not allow"
                      name="radioGroup"
                      onChange={() =>
                        this.props.dispatch(
                          setSiteSettings({allow_registration: false}),
                        )
                      }
                      checked={!this.props.siteSettings.allow_registration}
                    />
                  </Form.Field>
                </Form.Group>
              </Form>
            </Grid.Column>
          </Grid.Row>
        </Grid>

        <Divider />
        <Header as="h3">
          Users
          <Loader size="mini" active={this.props.fetchingUserList} inline />
        </Header>
          <Table compact celled>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Username</Table.HeaderCell>
                <Table.HeaderCell>Scan Directory</Table.HeaderCell>
                <Table.HeaderCell>Minimum Confidence</Table.HeaderCell>
                <Table.HeaderCell>Photo Count</Table.HeaderCell>
                <Table.HeaderCell>Joined</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {this.props.userList.map(user => {
                return (
                    <Table.Row>
                      <Table.Cell>{user.username}</Table.Cell>
                      <Table.Cell error={!user.scan_directory}>
                        <Icon
                            name="edit"
                            onClick={() => {
                              this.setState({
                                userToEdit: user,
                                modalOpen: true,
                              });
                            }}
                        />
                        {user.scan_directory ? user.scan_directory : 'Not set'}
                      </Table.Cell>
                      <Table.Cell>{user.confidence ? user.confidence : 'Not set'}</Table.Cell>
                      <Table.Cell>{user.photo_count}</Table.Cell>
                      <Table.Cell>{moment(user.date_joined).fromNow()}</Table.Cell>
                    </Table.Row>
                );
              })}
            </Table.Body>
          </Table>

        <Divider />

        <JobList />

        <ModalScanDirectoryEdit
          onRequestClose={() => {
            this.setState({modalOpen: false});
          }}
          userToEdit={this.state.userToEdit}
          isOpen={this.state.modalOpen}
        />
      </div>
    );
  }
}

const modalStyles = {
  content: {
    top: 150,
    left: 40,
    right: 40,
    height: window.innerHeight - 300,

    overflow: 'hidden',
    padding: 0,
    backgroundColor: 'white',
  },
  overlay: {
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    position: 'fixed',
    borderRadius: 0,
    border: 0,
    zIndex: 102,
    backgroundColor: 'rgba(200,200,200,0.8)',
  },
};

class JobList extends Component {
  state = {activePage: 1, pageSize: 10};

  componentDidMount() {
    if (this.props.auth.access.is_admin) {
      this.props.dispatch(
        fetchJobList(this.state.activePage, this.state.pageSize),
      );
    }
  }

  render() {
    return (
      <div>
        <Header as="h3">
          Worker Logs{' '}
          <Loader size="mini" active={this.props.fetchingJobList} inline />
        </Header>
        <Button
          size="mini"
          onClick={() => {
            this.props.dispatch(
              fetchJobList(this.state.activePage, this.state.pageSize),
            );
          }}>
          Reload
        </Button>
        <Table compact attached="top" celled>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Status</Table.HeaderCell>
              <Table.HeaderCell>Job Type</Table.HeaderCell>
              <Table.HeaderCell width={5}>Progress</Table.HeaderCell>
              <Table.HeaderCell>Queued</Table.HeaderCell>
              <Table.HeaderCell>Started</Table.HeaderCell>
              <Table.HeaderCell>Duration</Table.HeaderCell>
              <Table.HeaderCell>Started By</Table.HeaderCell>
              <Table.HeaderCell>Delete</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {this.props.jobList.map(job => {
              let progressPerc = 0;
              if (job.result.progress) {
                progressPerc =
                  (job.result.progress.current.toFixed() /
                    job.result.progress.target) *
                  100;
              }
              if (job.finished && !job.failed) {
                progressPerc = 100;
              }
              const jobSuccess = job.finished && !job.failed;
              return (
                <Table.Row
                  key={job.job_id}
                  error={job.failed}
                  warning={!job.finished_at}>
                  <Table.Cell>
                    {job.finished ? (
                      job.failed ? (
                        <Icon name="warning sign" color="red" />
                      ) : (
                        <Icon name="checkmark" color="green" />
                      )
                    ) : job.started_at ? (
                      <Icon name="refresh" loading color="yellow" />
                    ) : (
                      <Icon name="wait" color="blue" />
                    )}
                  </Table.Cell>
                  <Table.Cell>{job.job_type_str}</Table.Cell>
                  <Table.Cell>
                    {job.result.progress.target !== 0 && !job.finished ? (
                      <Progress
                        indicating
                        size="small"
                        progress="ratio"
                        value={job.result.progress.current}
                        total={
                          job.result.progress.target > 0
                            ? job.result.progress.target
                            : 1
                        }
                        active={!job.finished}
                        success={jobSuccess}>
                        {(
                          job.result.progress.current.toFixed(2) /
                          job.result.progress.target
                        ).toFixed(2) * 100}
                        %
                      </Progress>
                    ) : job.finished ? (
                      <Progress
                        success={!job.failed}
                        error={job.failed}
                        percent={100}>
                        {job.result.progress.current} Item(s) processed{' '}
                      </Progress>
                    ) : null}
                  </Table.Cell>
                  <Table.Cell>{moment(job.queued_at).fromNow()}</Table.Cell>
                  <Table.Cell>
                    {job.started_at ? moment(job.started_at).fromNow() : ''}
                  </Table.Cell>

                  <Table.Cell>
                    {job.finished
                      ? moment
                          .duration(
                            moment(job.finished_at) - moment(job.started_at),
                          )
                          .humanize()
                      : job.started_at
                      ? 'running'
                      : ''}
                  </Table.Cell>
                  <Table.Cell>{job.started_by.username}</Table.Cell>
                  <Table.Cell>
                    <Popup
                      trigger={
                        <Button
                          onClick={() => {
                            this.props.dispatch(
                              deleteJob(
                                job.id,
                                this.state.activatePage,
                                this.state.pageSize,
                              ),
                            );
                          }}
                          color="red"
                          size="tiny">
                          Remove
                        </Button>
                      }
                      content="Does not actually stop the job, only removes this entry from DB. Use only in cases when you know that a job failed ungracefully, by inspecting the logs, etc."
                    />
                  </Table.Cell>
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table>
        <Pagination
          attached="bottom"
          defaultActivePage={this.state.page}
          ellipsisItem={{
            content: <Icon name="ellipsis horizontal" />,
            icon: true,
          }}
          firstItem={{content: <Icon name="angle double left" />, icon: true}}
          lastItem={{content: <Icon name="angle double right" />, icon: true}}
          prevItem={{content: <Icon name="angle left" />, icon: true}}
          nextItem={{content: <Icon name="angle right" />, icon: true}}
          totalPages={Math.ceil(
            this.props.jobCount.toFixed(1) / this.state.pageSize,
          )}
          onPageChange={(e, d) => {
            console.log(d.activePage);
            this.setState({activePage: d.activePage});
            this.props.dispatch(
              fetchJobList(d.activePage, this.state.pageSize),
            );
          }}
        />
      </div>
    );
  }
}

class ModalScanDirectoryEdit extends Component {
  constructor(props) {
    super(props);
    this.state = {newScanDirectory: '', treeData: [], newConfidence: ''}
    this.nodeClicked = this.nodeClicked.bind(this);
    this.inputRef = React.createRef();
  }

  static getDerivedStateFromProps(nextProps, prevState) {
    if (prevState.treeData.length === 0) {
      return {...prevState, treeData: nextProps.directoryTree};
    } else {
      return prevState;
    }
  }

  nodeClicked(event, rowInfo) {
    console.log(rowInfo);
    this.inputRef.current.inputRef.value = rowInfo.node.absolute_path;
    this.setState({newScanDirectory: rowInfo.node.absolute_path});
  }

  render() {
    return (
        <Modal
            ariaHideApp={false}
            isOpen={this.props.isOpen}
            onRequestClose={() => {
              this.props.onRequestClose();
              this.setState({newScanDirectory: '', newConfidence: ''});
            }}
            style={modalStyles}>
          <div style={{padding: 10}}>
            <Header as="h3">
              Set the scan directory for user "
              {this.props.userToEdit ? this.props.userToEdit.username : '...'}"
              <Header.Subheader>
                When the user "
                {this.props.userToEdit ? this.props.userToEdit.username : '...'}"
                clicks on the 'scan photos' button, photos in the directory that
                you specify here will be imported under the user's account.
              </Header.Subheader>
            </Header>
          </div>
          <Grid>
            <Grid.Row>
              <Grid.Column>
                <div style={{padding: 10}}>
                  <Header as="h5">User's current directory and minimum confidence</Header>
                </div>
                <div style={{padding: 7}}>
                  <Input
                      ref={this.inputRef}
                      type="text"
                      placeholder={
                        this.props.userToEdit
                            ? this.props.userToEdit.scan_directory === ''
                            ? 'not set'
                            : this.props.userToEdit.scan_directory
                            : '...'
                      }
                      action
                      fluid>
                    <input />
                    <Button
                        type="submit"
                        color="green"
                        onClick={() => {
                            if (this.state.newScanDirectory === "") {
                                this.state.newScanDirectory = this.props.userToEdit.scan_directory;
                            }
                          const newUserData = {
                            ...this.props.userToEdit,
                            scan_directory: this.state.newScanDirectory,
                          };
                          console.log(newUserData);
                          this.props.dispatch(manageUpdateUser(newUserData));
                          this.props.onRequestClose();
                        }}>
                      Update
                    </Button>
                  </Input>
                </div>
              </Grid.Column>
            </Grid.Row>
            <Grid.Row>
              <Grid.Column>
                <div style={{padding: 10}}>
                  <Header as="h5">Choose a directory from below</Header>
                </div>
                <div
                    style={{
                      height: 300,
                      width: '100%',
                      paddingLeft: 7,
                      paddingTop: 7,
                      paddingBottom: 7,
                    }}>
                  <SortableTree
                      innerStyle={{outline: 'none'}}
                      canDrag={() => false}
                      canDrop={() => false}
                      treeData={this.state.treeData}
                      onChange={treeData => this.setState({treeData})}
                      theme={FileExplorerTheme}
                      generateNodeProps={rowInfo => {
                        let nodeProps = {
                          onClick: event => this.nodeClicked(event, rowInfo),
                        };
                        if (this.state.selectedNodeId === rowInfo.node.id) {
                          nodeProps.className = 'selected-node';
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

JobList = connect(store => {
  return {
    auth: store.auth,
    jobList: store.util.jobList,
    jobCount: store.util.jobCount,
    fetchingJobList: store.util.fetchingJobList,
    fetchedJobList: store.util.fetchedJobList,
  };
})(JobList);

ModalScanDirectoryEdit = connect(store => {
  return {
    auth: store.auth,

    directoryTree: store.util.directoryTree,
    fetchingDirectoryTree: store.util.fetchingDirectoryTree,
    fetchedDirectoryTree: store.util.fetchedDirectoryTree,

    userList: store.util.userList,
    fetchingUSerList: store.util.fetchingUserList,
    fetchedUserList: store.util.fetchedUserList,
  };
})(ModalScanDirectoryEdit);

AdminPage = connect(store => {
  return {
    auth: store.auth,
    util: store.util,
    gridType: store.ui.gridType,
    siteSettings: store.util.siteSettings,
    statusPhotoScan: store.util.statusPhotoScan,
    statusAutoAlbumProcessing: store.util.statusAutoAlbumProcessing,
    generatingAutoAlbums: store.util.generatingAutoAlbums,
    scanningPhotos: store.photos.scanningPhotos,
    fetchedCountStats: store.util.fetchedCountStats,
    workerAvailability: store.util.workerAvailability,
    fetchedNextcloudDirectoryTree: store.util.fetchedNextcloudDirectoryTree,
    userSelfDetails: store.user.userSelfDetails,
    fetchingJobList: store.util.fetchingJobList,
    fetchedJobList: store.util.fetchedJobList,
    userList: store.util.userList,
    fetchingUserList: store.util.fetchingUserList,
    fetchedUserList: store.util.fetchedUserList,
  };
})(AdminPage);
