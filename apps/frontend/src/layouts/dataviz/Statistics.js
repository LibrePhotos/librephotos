/* eslint-disable */
import { Tabs } from "@mantine/core";
import React, { Component } from "react";
import { withTranslation } from "react-i18next";
import { connect } from "react-redux";
import { compose } from "redux";
import { ChartArea, Cloud, Share, Sitemap, User } from "tabler-icons-react";

import { EventCountMonthGraph } from "../../components/charts/EventCountMonthGraph";
import FaceClusterScatter from "../../components/charts/FaceClusterGraph";
import { LocationDurationStackedBar } from "../../components/charts/LocationDurationStackedBar";
import SocialGraph from "../../components/charts/SocialGraph";
import WordCloud from "../../components/charts/WordCloud";
import { LocationLink } from "../../components/locationLink";
import { CountStats } from "../../components/statistics";

export class Statistics extends Component {
  render() {
    return (
      <div style={{ padding: "10px 0" }}>
        <CountStats />

        <Tabs position="apart">
          <Tabs.Tab label={this.props.t("placetree")} icon={<Sitemap />}>
            <div>
              <LocationLink width={window.innerWidth - 120} height={window.innerHeight - 50} />
            </div>
          </Tabs.Tab>

          <Tabs.Tab label={this.props.t("wordclouds")} icon={<Cloud />}>
            <div style={{ marginTop: "1rem" }}>
              <WordCloud height={320} type="location" />
            </div>
            <div style={{ marginTop: "1rem" }}>
              <WordCloud height={320} type="captions" />
            </div>
            <div style={{ marginTop: "1rem" }}>
              <WordCloud height={320} type="people" />
            </div>
          </Tabs.Tab>

          <Tabs.Tab label={this.props.t("timeline")} icon={<ChartArea />}>
            <div style={{ marginTop: "1rem" }}>
              <EventCountMonthGraph />
            </div>
            <div style={{ marginTop: "1rem" }}>
              <LocationDurationStackedBar />
            </div>
          </Tabs.Tab>

          <Tabs.Tab label={this.props.t("socialgraph")} icon={<Share />}>
            <div style={{ marginTop: "1rem" }}>
              <SocialGraph height={window.innerHeight - 300} />
            </div>
          </Tabs.Tab>

          <Tabs.Tab label={this.props.t("facecluster")} icon={<User />}>
            <div style={{ marginTop: "1rem" }}>
              <FaceClusterScatter height={window.innerHeight - 320} />
            </div>
          </Tabs.Tab>
        </Tabs>
      </div>
    );
  }
}

Statistics = compose(
  connect(store => ({
    statusPhotoScan: store.util.statusPhotoScan,
    statusAutoAlbumProcessing: store.util.statusAutoAlbumProcessing,
    generatingAlbumsAuto: store.albums.generatingAlbumsAuto,
    scanningPhotos: store.photos.scanningPhotos,
    fetchedCountStats: store.util.fetchedCountStats,
  })),
  withTranslation()
)(Statistics);
