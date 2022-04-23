import React, { Component } from "react";
import { connect } from "react-redux";
import { Divider } from "semantic-ui-react";

import { fetchWordCloud } from "../../actions/utilActions";
import { EventCountMonthGraph } from "../../components/charts/EventCountMonthGraph";
import FaceClusterScatter from "../../components/charts/FaceClusterGraph";
import { LocationDurationStackedBar } from "../../components/charts/LocationDurationStackedBar";
import SocialGraph from "../../components/charts/SocialGraph";
import { WordCloud } from "../../components/charts/WordCloud";
import { LocationLink } from "../../components/locationLink";
import { AlbumPlace } from "../albums/AlbumPlace";

export class LocationTree extends Component {
  render() {
    return (
      <div>
        <LocationLink width={window.innerWidth - 120} height={window.innerHeight - 50} />
      </div>
    );
  }
}

export class PhotoMap extends Component {
  render() {
    return (
      <div style={{ marginLeft: -5 }}>
        <AlbumPlace height={window.innerHeight - 55} />
      </div>
    );
  }
}

export class WordClouds extends Component {
  componentDidMount() {
    fetchWordCloud(this.props.dispatch);
  }

  render() {
    return (
      <div style={{ padding: 10 }}>
        <div>
          <WordCloud height={320} type="location" />
          <Divider hidden />
          <WordCloud height={320} type="captions" />
          <Divider hidden />
          <WordCloud height={320} type="people" />
        </div>
      </div>
    );
  }
}

WordClouds = connect(store => ({
  statusPhotoScan: store.util.statusPhotoScan,
  statusAutoAlbumProcessing: store.util.statusAutoAlbumProcessing,
  generatingAlbumsAuto: store.albums.generatingAlbumsAuto,
  scanningPhotos: store.photos.scanningPhotos,
  fetchedCountStats: store.util.fetchedCountStats,
}))(WordClouds);

export class Timeline extends Component {
  render() {
    return (
      <div style={{ padding: 10 }}>
        <div>
          <EventCountMonthGraph />
          <Divider hidden />
          <LocationDurationStackedBar />
        </div>
      </div>
    );
  }
}

export class Graph extends Component {
  render() {
    return (
      <div style={{ maringLeft: -5 }}>
        <SocialGraph height={window.innerHeight - 60} />
      </div>
    );
  }
}

export class FaceScatter extends Component {
  render() {
    return (
      <div>
        <FaceClusterScatter height={window.innerHeight - 55} />
      </div>
    );
  }
}
