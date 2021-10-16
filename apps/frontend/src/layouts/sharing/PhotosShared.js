import React, { Component } from "react";
import { connect } from "react-redux";
import { Header, Icon, Loader } from "semantic-ui-react";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { PhotosetType } from "../../reducers/photosReducer";

class GroupHeader extends Component {
  render() {
    const owner = this.props.pub.publicUserList.filter(
      (e) => e.id === this.props.group.user_id
    )[0];
    var displayName = this.props.group.user_id;
    if (owner && owner.last_name.length + owner.first_name.length > 0) {
      displayName = owner.first_name + " " + owner.last_name;
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
              {this.props.photosetType === PhotosetType.SHARED_BY_ME
                ? `you shared ${this.props.group.photos.length} photos`
                : `shared ${this.props.group.photos.length} photos with you`}
            </Header.Subheader>
          </Header.Content>
        </Header>
      </div>
    );
  }
}

GroupHeader = connect((store) => {
  return {
    pub: store.pub,
  }
})(GroupHeader);

export class PhotosShared extends Component {
  render() {
    const loadingText = this.props.photosetType === PhotosetType.SHARED_BY_ME
      ? "Loading photos shared by you..."
      : "Loading photos shared with you..."
    return (
      <div>
        {this.props.fetchedPhotosetType !== this.props.photosetType
          ? <Loader active>{loadingText}</Loader>
          : this.props.photosGroupedByUser.map((group) => {
            return (
              <PhotoListView
                title={"Photos"}
                loading={this.props.fetchedPhotosetType !== this.props.photosetType}
                titleIconName={"images"}
                isDateView={false}
                photoset={group.photos}
                idx2hash={group.photos}
                isPublic={true}
                header={<GroupHeader group={group} photosetType={this.props.photosetType} />}
                selectable={false}
              />
            );
          })}
      </div>
    );
  }
}

PhotosShared = connect((store) => {
  return {
    photosGroupedByUser: store.photos.photosGroupedByUser,
    fetchedPhotosetType: store.photos.fetchedPhotosetType,
  };
})(PhotosShared);