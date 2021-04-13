import React, { Component } from "react";
import { Input, Image, Icon, Header, Divider, Button } from "semantic-ui-react";
import { SecuredImageJWT } from "../components/SecuredImage";
import { connect } from "react-redux";
import { fetchPublicUserList } from "../actions/publicActions";
import { serverAddress } from "../api_client/apiClient";
import { setPhotosShared } from "../actions/photosActions";
import Modal from "react-modal";
import moment from "moment";

function fuzzy_match(str, pattern) {
  if (pattern.split("").length > 0) {
    pattern = pattern.split("").reduce(function(a, b) {
      return a + ".*" + b;
    });
    return new RegExp(pattern).test(str);
  } else {
    return false;
  }
}

const modalStyles = {
  content: {
    top: 150,
    left: 40,
    right: 40,
    height: window.innerHeight - 300,

    overflow: "hidden",
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

export class ModalPhotosShare extends Component {
  state = { userNameFilter: "", valShare: true };
  render() {
    var filteredUserList
    if (this.state.userNameFilter.length > 0) {
      filteredUserList = this.props.pub.publicUserList.filter(
        el =>
          fuzzy_match(
            el.username.toLowerCase(),
            this.state.userNameFilter.toLowerCase()
          ) ||
          fuzzy_match(
            el.first_name.toLowerCase() + " " + el.last_name.toLowerCase(),
            this.state.userNameFilter.toLowerCase()
          )
      );
    } else {
      filteredUserList = this.props.pub.publicUserList;
    }
    filteredUserList = filteredUserList.filter(
      el => el.id !== this.props.auth.access.user_id
    );

    var selectedImageSrcs = this.props.selectedImageHashes.map(image_hash => {
      return serverAddress + "/media/square_thumbnails/" + image_hash + ".jpg";
    });
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
            {this.state.valShare ? "Share Photos" : "Unshare Photos"}
            <Header.Subheader>
              {this.state.valShare ? "Share " : "Unshare "} selected{" "}
              {this.props.selectedImageHashes.length} photo(s) with...
            </Header.Subheader>
          </Header>
        </div>
        <Divider fitted />
        <div
          style={{ padding: 5, height: 50, overflowY: "hidden" }}
        >
          <Image.Group>
            {selectedImageSrcs
              .slice(0, 100)
              .map(image => (
                <SecuredImageJWT
                  key={"selected_image" + image}
                  height={40}
                  width={40}
                  src={image}
                />
              ))}
          </Image.Group>
        </div>
        <Divider fitted />
        <div
          style={{
            paddingLeft: 10,
            paddingTop: 10,
            overflowY: "scroll",
            height: window.innerHeight - 300 - 100,
            width: "100%"
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
              var displayName = item.username;
              if (item.first_name.length > 0 && item.last_name.length > 0) {
                var displayName = item.first_name + " " + item.last_name;
              }
              return (
                <div
                  key={"modal_photos_share_user_" + item.username}
                  style={{
                    height: 70,
                    justifyContent: "center",
                    alignItems: "center"
                  }}
                >
                  <Header
                    floated="left"
                    as="h4"
                    onClick={() => {
                    }}
                  >
                    <Image circular src="/unknown_user.jpg" />
                    <Header.Content>
                      {displayName}
                      <Header.Subheader>
                        Joined {moment(item.date_joined).format("MMMM YYYY")}
                      </Header.Subheader>
                    </Header.Content>
                  </Header>
                  <Header floated="right" as="h5">
                    <Button.Group size="mini" compact>
                      <Button
                        onClick={() => {
                          this.props.dispatch(
                            setPhotosShared(
                              this.props.selectedImageHashes,
                              true,
                              item
                            )
                          );
                        }}
                        positive
                        icon
                      >
                        <Icon name='linkify'/>
                        Share
                      </Button>
                      <Button.Or/>
                      <Button
                        onClick={() => {
                          this.props.dispatch(
                            setPhotosShared(
                              this.props.selectedImageHashes,
                              false,
                              item
                            )
                          );
                        }}
                        negative
                        icon
                      >
                        <Icon name='linkify'/>
                        Unshare
                      </Button>
                    </Button.Group>
                  </Header>
                </div>
              );
            })}
        </div>
      </Modal>
    );
  }
}

ModalPhotosShare = connect(store => {
  return {
    auth: store.auth,
    people: store.people.people,
    fetchingPeople: store.people.fetchingPeople,
    fetchedPeople: store.people.fetchedPeople,

    inferredFacesList: store.faces.inferredFacesList,
    labeledFacesList: store.faces.labeledFacesList,

    fetchingLabeledFacesList: store.faces.fetchingLabeledFacesList,
    fetchedLabeledFacesList: store.faces.fetchedLabeledFacesList,
    fetchingInferredFacesList: store.faces.fetchingInferredFacesList,
    fetchedInferredFacesList: store.faces.fetchedInferredFacesList,

    pub: store.pub
  };
})(ModalPhotosShare);
