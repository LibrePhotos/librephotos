import React, { Component } from "react";
import "react-virtualized/styles.css"; // only needs to be imported once
import { connect } from "react-redux";
import { PhotoListView } from "../components/photolist/PhotoListView";
import { PhotosetType } from "../reducers/photosReducer";
import { Redirect } from "react-router-dom";

export class SearchView extends Component {
  render() {
    if (!this.props.searchQuery) {
      // User hasn't searched for anything. Redirect to root.
      return <Redirect to={"/"} />;
    }

    const title = `Searching "${this.props.searchQuery}"...`;
    return (
      <PhotoListView
        title={title}
        loading={this.props.fetchedPhotosetType !== PhotosetType.SEARCH}
        titleIconName={"search"}
        isDateView={true}
        photoset={this.props.photosGroupedByDate}
        idx2hash={this.props.photosFlat}
      />
    );
  }
}

SearchView = connect((store) => {
  return {
    photosFlat: store.photos.photosFlat,
    photosGroupedByDate: store.photos.photosGroupedByDate,
    fetchedPhotosetType: store.photos.fetchedPhotosetType,
    searchQuery: store.search.query,
  };
})(SearchView);
