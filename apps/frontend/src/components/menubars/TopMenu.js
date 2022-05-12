import { Grid, Group, Header } from "@mantine/core";
import { push } from "connected-react-router";
import _ from "lodash";
import React, { Component } from "react";
import { Trans, withTranslation } from "react-i18next";
import { connect } from "react-redux";
import { compose } from "redux";
import { Button, Dropdown, Icon, Image, Menu, Popup, Progress } from "semantic-ui-react";

import { toggleSidebar } from "../../actions/uiActions";
import { fetchWorkerAvailability } from "../../actions/utilActions";
import { api } from "../../api_client/api";
import { serverAddress } from "../../api_client/apiClient";
import { logout } from "../../store/auth/authSlice";
import { ChunkedUploadButton } from "../ChunkedUploadButton";
import { CustomSearch } from "../CustomSearch";
import "./TopMenu.css";

export class TopMenu extends Component {
  state = {
    width: window.innerWidth,
  };

  throttledFetchUserSelfDetails = _.throttle(
    user_id => this.props.dispatch(this.props.fetchUserSelfDetails(user_id)),
    500,
    { leading: true, trailing: false }
  );

  constructor(props) {
    super(props);
    this.handleResize = this.handleResize.bind(this);
  }

  handleResize() {
    this.setState({ width: window.innerWidth });
  }

  componentWillReceiveProps(nextProps) {
    if (!nextProps.auth.access) return;
    if (this.props.userSelfDetails && this.props.userSelfDetails.id === nextProps.auth.access.user_id) return;

    this.throttledFetchUserSelfDetails(nextProps.auth.access.user_id);
  }

  componentDidMount() {
    const intervalId = setInterval(() => {
      fetchWorkerAvailability(this.props.workerRunningJob, this.props.dispatch);
    }, 2000);
    this.setState({ intervalId: intervalId });
  }

  componentWillUnmount() {
    window.removeEventListener("resize", this.handleResize.bind(this));
    clearInterval(this.state.intervalId);
  }

  render() {
    let runningJobPopupProgress = null;
    if (
      this.props.workerRunningJob &&
      this.props.workerRunningJob.result &&
      this.props.workerRunningJob.result.progress
    ) {
      runningJobPopupProgress = (
        <div style={{ width: 150 }}>
          <Progress
            indicating
            progress
            percent={(
              (this.props.workerRunningJob.result.progress.current.toFixed(2) /
                this.props.workerRunningJob.result.progress.target) *
              100
            ).toFixed(0)}
          >
            <Trans i18nKey="topmenu.running">Running</Trans> {this.props.workerRunningJob.job_type_str} ...
          </Progress>
        </div>
      );
    }

    return (
      <Header height={45}>
        <Grid justify="space-between" grow style={{ padding: 5 }}>
          <Grid.Col span={1}>
            <Group>
              <Icon
                size="big"
                onClick={() => {
                  this.props.dispatch(toggleSidebar());
                }}
                name="sidebar"
              />
              <Button
                color="black"
                style={{
                  padding: 2,
                }}
              >
                <Image height={30} src="/logo-white.png" />
              </Button>
            </Group>
          </Grid.Col>
          <Grid.Col span={3}>
            <CustomSearch />
          </Grid.Col>
          <Grid.Col span={1}>
            <Group position="right">
              <ChunkedUploadButton />
              <Popup
                trigger={<Icon name="circle" color={!this.props.workerAvailability ? "red" : "green"} />}
                position="bottom right"
                offset={[13, 0]}
                content={
                  this.props.workerAvailability
                    ? this.props.t("topmenu.available")
                    : !this.props.workerAvailability && this.props.workerRunningJob
                    ? runningJobPopupProgress
                    : this.props.t("topmenu.busy")
                }
              />

              <Dropdown
                trigger={
                  <span>
                    <Image
                      avatar
                      src={
                        this.props.userSelfDetails && this.props.userSelfDetails.avatar_url
                          ? serverAddress + this.props.userSelfDetails.avatar_url
                          : "/unknown_user.jpg"
                      }
                    />
                    <Icon name="caret down" />
                  </span>
                }
                icon={null}
              >
                <Dropdown.Menu>
                  <Dropdown.Header>
                    <Trans i18nKey="topmenu.loggedin">Logged in as</Trans>{" "}
                    {this.props.auth.access ? this.props.auth.access.name : ""}
                  </Dropdown.Header>

                  <Dropdown.Item onClick={() => this.props.dispatch(push("/library"))}>
                    <Icon name="book" />
                    <b>
                      <Trans i18nKey="topmenu.library">Library</Trans>
                    </b>
                  </Dropdown.Item>

                  <Dropdown.Item onClick={() => this.props.dispatch(push("/profile"))}>
                    <Icon name="user" />
                    <b>
                      <Trans i18nKey="topmenu.profile">Profile</Trans>
                    </b>
                  </Dropdown.Item>
                  <Dropdown.Item onClick={() => this.props.dispatch(push("/settings"))}>
                    <Icon name="settings" />
                    <b>
                      <Trans i18nKey="topmenu.settings">Settings</Trans>
                    </b>
                  </Dropdown.Item>
                  {this.props.auth.access && this.props.auth.access.is_admin && <Dropdown.Divider />}

                  {this.props.auth.access && this.props.auth.access.is_admin && (
                    <Dropdown.Item onClick={() => this.props.dispatch(push("/admin"))}>
                      <Icon name="wrench" />
                      <b>
                        <Trans i18nKey="topmenu.adminarea">Admin Area</Trans>
                      </b>
                    </Dropdown.Item>
                  )}

                  <Dropdown.Item onClick={() => this.props.dispatch(logout())}>
                    <Icon name="sign out" />
                    <b>
                      <Trans i18nKey="topmenu.logout">Logout</Trans>
                    </b>
                  </Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown>
            </Group>
          </Grid.Col>
        </Grid>
      </Header>
    );
  }
}

TopMenu = compose(
  connect(store => ({
    showSidebar: store.ui.showSidebar,
    gridType: store.ui.gridType,

    workerAvailability: store.util.workerAvailability,
    workerRunningJob: store.util.workerRunningJob,

    auth: store.auth,
    jwtToken: store.auth.jwtToken,
    exampleSearchTerms: store.util.exampleSearchTerms,
    fetchingExampleSearchTerms: store.util.fetchingExampleSearchTerms,
    fetchedExampleSearchTerms: store.util.fetchedExampleSearchTerms,
    searchError: store.search.error,
    searchingPhotos: store.search.searchingPhotos,
    searchedPhotos: store.search.searchedPhotos,
    people: store.people.people,
    fetchingPeople: store.people.fetchingPeople,
    fetchedPeople: store.people.fetchedPeople,

    albumsThingList: store.albums.albumsThingList,
    fetchingAlbumsThingList: store.albums.fetchingAlbumsThingList,
    fetchedAlbumsThingList: store.albums.fetchedAlbumsThingList,

    albumsUserList: store.albums.albumsUserList,
    fetchingAlbumsUserList: store.albums.fetchingAlbumsUserList,
    fetchedAlbumsUserList: store.albums.fetchedAlbumsUserList,

    albumsPlaceList: store.albums.albumsPlaceList,
    fetchingAlbumsPlaceList: store.albums.fetchingAlbumsPlaceList,
    fetchedAlbumsPlaceList: store.albums.fetchedAlbumsPlaceList,
    userSelfDetails: store.user.userSelfDetails,
    fetchUserSelfDetails: api.endpoints.fetchUserSelfDetails.initiate,
  })),
  withTranslation()
)(TopMenu);
