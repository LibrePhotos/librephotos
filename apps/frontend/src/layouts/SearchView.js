import React, { Component } from "react";
// only needs to be imported once
import { connect } from "react-redux";
import { Redirect } from "react-router-dom";
import "react-virtualized/styles.css";

import { PhotoListView } from "../components/photolist/PhotoListView";
import { PhotosetType } from "../reducers/photosReducer";

export class SearchView extends Component {
  render() {
    if (!this.props.searchQuery) {
      // User hasn't searched for anything. Redirect to root.
      return <Redirect to="/" />;
    }
    // if semantic search is activated we get a flat array sorted by relevance
    // thats why we have to change the parameters
    const title = `Searching "${this.props.searchQuery}"...`;
    return (
      <PhotoListView
        title={title}
        loading={this.props.fetchedPhotosetType !== PhotosetType.SEARCH}
        titleIconName="search"
        isDateView={this.props.user.semantic_search_topk == 0}
        photoset={this.props.photosGroupedByDate}
        idx2hash={this.props.user.semantic_search_topk == 0 ? this.props.photosFlat : this.props.photosGroupedByDate}
        selectable
      />
    );
  }
}

SearchView = connect(store => ({
  user: store.user.userSelfDetails,
  photosFlat: store.photos.photosFlat,
  photosGroupedByDate: store.photos.photosGroupedByDate,
  fetchedPhotosetType: store.photos.fetchedPhotosetType,
  searchQuery: store.search.query,
}))(SearchView);
