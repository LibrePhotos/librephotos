import React, { Component } from "react";
import "react-virtualized/styles.css"; // only needs to be imported once
import { connect } from "react-redux";
import { PhotoListView } from "../components/photolist/PhotoListView";
import { Photoset } from "../reducers/photosReducer";

export class SearchView extends Component {
  render() {
    // I don't know when the alternative titles would be shown, since the
    // title only seems to be shown when `loading` is false.
    // When it's not loading, and `photosGroupedByDate` is empty,
    // PhotoListView will just show "No images found".
    const title = this.props.photosGroupedByDate
      ? `Searching "${this.props.searchQuery}"...`
      : this.props.searchQuery === null
      ? "Search for things, places, people, and time."
      : `"${this.props.searchQuery}"`;
    return (
      <PhotoListView
        title={title}
        loading={
          this.props.searchQuery &&
          this.props.fetchedPhotoset !== Photoset.SEARCH
        }
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
