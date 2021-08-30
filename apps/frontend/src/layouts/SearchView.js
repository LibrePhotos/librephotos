import React, { Component } from "react";
import "react-virtualized/styles.css"; // only needs to be imported once
import { connect } from "react-redux";
import { PhotoListView } from "../components/photolist/PhotoListView";
import { Photoset } from "../reducers/photosReducer";
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
        loading={this.props.fetchedPhotoset !== Photoset.SEARCH}
        titleIconName={"search"}
        isDateView={true}
        photosGroupedByDate={this.props.photosGroupedByDate}
        idx2hash={this.props.photosFlat}
      />
    );
  }
}

SearchView = connect((store) => {
  return {
    photosFlat: store.photos.photosFlat,
    photosGroupedByDate: store.photos.photosGroupedByDate,
    fetchedPhotoset: store.photos.fetchedPhotoset,
    searchQuery: store.search.query,
  };
})(SearchView);
