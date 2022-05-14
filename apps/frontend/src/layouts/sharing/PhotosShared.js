import React, { Component } from "react";
import { connect } from "react-redux";
import { Header, Icon, Loader } from "semantic-ui-react";

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
        <Header as="h3">
          <Icon name="user circle outline" />
          <Header.Content>
            {displayName}
            <Header.Subheader>
              <Icon name="photo" />
              {this.props.isSharedToMe
                ? `shared ${this.props.group.photos.length} photos with you`
                : `you shared ${this.props.group.photos.length} photos`}
            </Header.Subheader>
          </Header.Content>
        </Header>
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
          <Loader active>{loadingText}</Loader>
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
