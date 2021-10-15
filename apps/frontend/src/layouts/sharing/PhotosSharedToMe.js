import React, { Component } from "react";
import { connect } from "react-redux";
import { Header, Icon, Loader } from "semantic-ui-react";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { PhotosetType } from "../../reducers/photosReducer";

export class PhotosSharedToMe extends Component {
  getGroupHeader(group) {
    const owner = this.props.pub.publicUserList.filter(
      (e) => e.id === group.user_id
    )[0];
    var displayName = group.user_id;
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
              shared {group.photos.length} photos with you
            </Header.Subheader>
          </Header.Content>
        </Header>
      </div>
    );
  }

  render() {
    return (
      <div>
        {this.props.fetchedPhotosetType !== PhotosetType.SHARED_TO_ME
          ? <Loader active>Loading photos shared with you...</Loader>
          : this.props.photosGroupedByUser.map((group) => {
            return (
              <PhotoListView
                title={"Photos"}
                additionalSubHeader={" shared by user with id " + group.user_id}
                loading={this.props.fetchedPhotosetType !== PhotosetType.SHARED_TO_ME}
                titleIconName={"images"}
                isDateView={false}
                photoset={group.photos}
                idx2hash={group.photos}
                isPublic={true}
                getHeader={(photoList) => this.getGroupHeader(group)}
                selectable={false}
              />
            );
          })}
      </div>
    );
  }
}

PhotosSharedToMe = connect((store) => {
  return {
    photosGroupedByUser: store.photos.photosGroupedByUser,
    fetchedPhotosetType: store.photos.fetchedPhotosetType,
    pub: store.pub,
  };
})(PhotosSharedToMe);