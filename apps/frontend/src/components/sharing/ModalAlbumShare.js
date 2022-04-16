import moment from "moment";
import React, { Component } from "react";
import Modal from "react-modal";
import { connect } from "react-redux";
import { Checkbox, Divider, Header, Icon, Image, Input, Popup } from "semantic-ui-react";

import { setUserAlbumShared } from "../../actions/albumsActions";
import { fetchPublicUserList } from "../../actions/publicActions";

function fuzzy_match(str, pattern) {
  if (pattern.split("").length > 0) {
    pattern = pattern.split("").reduce((a, b) => `${a}.*${b}`);
    return new RegExp(pattern).test(str);
  }
  return false;
}

const modalStyles = {
  content: {
    top: 150,
    left: 40,
    right: 40,
    height: window.innerHeight - 300,

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

export class ModalAlbumShare extends Component {
  state = {
    userNameFilter: "",
    valShare: true,
  };

  render() {
    let filteredUserList;
    if (this.state.userNameFilter.length > 0) {
      filteredUserList = this.props.pub.publicUserList.filter(
        el =>
          fuzzy_match(el.username.toLowerCase(), this.state.userNameFilter.toLowerCase()) ||
          fuzzy_match(
            `${el.first_name.toLowerCase()} ${el.last_name.toLowerCase()}`,
            this.state.userNameFilter.toLowerCase()
          )
      );
    } else {
      filteredUserList = this.props.pub.publicUserList;
    }
    filteredUserList = filteredUserList.filter(el => el.id !== this.props.auth.access.user_id);
    const { albumDetails } = this.props;

    return (
      <Modal
        ariaHideApp={false}
        onAfterOpen={() => {
          this.props.dispatch(fetchPublicUserList());
        }}
        isOpen={this.props.isOpen}
        onRequestClose={() => {
          this.props.onRequestClose();
          this.setState({ userNameFilter: "" });
        }}
        style={modalStyles}
      >
        <div style={{ height: 50, width: "100%", padding: 7 }}>
          <Header>
            {this.state.valShare ? "Share Album" : "Unshare Album"}
            <Header.Subheader>{this.state.valShare ? "Share" : "Unshare"} current album with...</Header.Subheader>
          </Header>
        </div>
        <Divider fitted />
        <div
          style={{
            paddingLeft: 10,
            paddingTop: 10,
            overflowY: "scroll",
            height: window.innerHeight - 300 - 100,
            width: "100%",
          }}
        >
          <div style={{ paddingRight: 5 }}>
            <Header as="h4">Search user</Header>
            <Input
              fluid
              onChange={(e, v) => {
                this.setState({ userNameFilter: v.value });
              }}
              placeholder="Person name"
            />
          </div>
          <Divider />
          {filteredUserList.length > 0 &&
            filteredUserList.map(item => {
              let displayName;
              if (item.first_name.length > 0 && item.last_name.length > 0) {
                displayName = `${item.first_name} ${item.last_name}`;
              } else {
                displayName = item.username;
              }
              return (
                <div
                  key={`modal_albums_share_user_${item.username}`}
                  style={{
                    height: 70,
                    justifyContent: "center",
                    alignItems: "center",
                  }}
                >
                  <Header
                    as="h4"
                    onClick={() => {
                      this.props.dispatch(
                        setUserAlbumShared(parseInt(this.props.match.params.albumID, 10), item.id, this.state.valShare)
                      );
                      this.props.onRequestClose();
                    }}
                  >
                    <Image circular src="/unknown_user.jpg" />
                    <Header.Content>
                      {displayName}
                      {albumDetails.shared_to && albumDetails.shared_to.map(e => e.id).includes(item.id) && (
                        <Popup trigger={<Icon flipped="horizontally" name="share" />} inverted content="Shared" />
                      )}
                      <Header.Subheader>Joined {moment(item.date_joined).format("MMMM YYYY")}</Header.Subheader>
                    </Header.Content>
                  </Header>
                  <div
                    style={{
                      float: "right",
                      right: 10,
                      top: -40,
                      position: "relative",
                    }}
                  >
                    <Checkbox
                      inline
                      slider
                      checked={albumDetails.shared_to && albumDetails.shared_to.map(e => e.id).includes(item.id)}
                      onChange={(e, d) => {
                        this.props.dispatch(
                          setUserAlbumShared(
                            parseInt(this.props.match.params.albumID, 10),
                            item.id,
                            !albumDetails.shared_to.map(e => e.id).includes(item.id)
                          )
                        );
                      }}
                    />
                  </div>
                </div>
              );
            })}
        </div>
      </Modal>
    );
  }
}

ModalAlbumShare = connect(store => ({
  auth: store.auth,
  albumDetails: store.albums.albumDetails,
  pub: store.pub,
}))(ModalAlbumShare);
