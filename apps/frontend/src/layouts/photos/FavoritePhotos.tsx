import React, { Component } from "react";
import { connect } from "react-redux";
import {Dispatch, bindActionCreators} from "redux";
import { fetchFavoritePhotos } from "../../actions/photosActions";
import _ from "lodash";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { PhotosetType } from "../../reducers/photosReducer";
import { RootState} from "../../store"
import { IncompleteDatePhotosGroup, PigPhoto } from "../../actions/photosActions.types";

type FavoriteProps = {
  fetchedPhotosetType: PhotosetType,
  photosGroupedByDate: IncompleteDatePhotosGroup[],
  photosFlat: PigPhoto[],
  dispatch: any
} 

export class FavoritePhotos extends Component<FavoriteProps> {

  constructor(props: FavoriteProps) {
    super(props);
}

  componentDidMount() {
    if (this.props.fetchedPhotosetType !== PhotosetType.FAVORITES) {
      console.log(this.props)
      this.props.dispatch(fetchFavoritePhotos());
    }
  }

  render() {
    return (
      <PhotoListView
        showHidden={false}
        title={"Favorite Photos"}
        loading={this.props.fetchedPhotosetType !== PhotosetType.FAVORITES}
        titleIconName={"star"}
        isDateView={true}
        photoset={this.props.photosGroupedByDate}
        idx2hash={this.props.photosFlat}
        selectable={true}
      />
    );
  }
}

export default connect((store: RootState) => {
  return {
    photosFlat: store.photos.photosFlat,
    photosGroupedByDate: store.photos.photosGroupedByDate,
    fetchedPhotosetType: store.photos.fetchedPhotosetType
  };
}
)(FavoritePhotos);
