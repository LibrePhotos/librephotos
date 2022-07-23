/* eslint-disable */
import { Loader, Stack, Text } from "@mantine/core";
import React, { Component } from "react";
import { connect } from "react-redux";
import { Photo, Polaroid, User } from "tabler-icons-react";

import { PhotoListView } from "../../components/photolist/PhotoListView";
import { PhotosetType } from "../../reducers/photosReducer";

class GroupHeader extends Component {
  render() {
    const owner = this.props.pub.publicUserList.filter(e => e.id === this.props.group.userId)[0];
    let displayName = this.props.group.userId;
    if (owner && owner.last_name.length + owner.first_name.length > 0) {
      displayName = `${owner.first_name} ${owner.last_name}`;
    } else if (owner) {
      displayName = owner.username;
    }
    return (
      <div
        style={{
          paddingTop: 15,
          paddingBottom: 15,
        }}
      >
        <div style={{ display: "flex", textAlign: "left" }}>
          <User size={36} style={{ margin: 5 }} />
          <div>
            <Text size="md" weight="bold">
              {displayName}
            </Text>
            <Text size="xs" color="gray" style={{ display: "flex", alignItems: "center" }}>
              <Polaroid size={16} style={{ marginRight: 5 }} />
              {this.props.isSharedToMe
                ? `shared ${this.props.group.photos.length} photos with you`
                : `you shared ${this.props.group.photos.length} photos`}
            </Text>
          </div>
        </div>
      </div>
    );
  }
}

GroupHeader = connect(store => ({
  pub: store.pub,
}))(GroupHeader);

export class PhotosShared extends Component {
  render() {
    const photosetType = this.props.isSharedToMe ? PhotosetType.SHARED_TO_ME : PhotosetType.SHARED_BY_ME;
    const loadingText = this.props.isSharedToMe
      ? "Loading photos shared with you..."
      : "Loading photos shared by you...";
    return (
      <div>
        {this.props.fetchedPhotosetType !== photosetType ? (
          <Stack align="center">
            <Loader />
            {loadingText}
          </Stack>
        ) : (
          this.props.photosGroupedByUser.map(group => (
            <PhotoListView
              title="Photos"
              loading={this.props.fetchedPhotosetType !== photosetType}
              icon={<Photo size={50} />}
              isDateView={false}
              photoset={group.photos}
              idx2hash={group.photos}
              isPublic
              header={<GroupHeader group={group} isSharedToMe={this.props.isSharedToMe} />}
              selectable={false}
            />
          ))
        )}
      </div>
    );
  }
}

PhotosShared = connect(store => ({
  photosGroupedByUser: store.photos.photosGroupedByUser,
  fetchedPhotosetType: store.photos.fetchedPhotosetType,
}))(PhotosShared);
