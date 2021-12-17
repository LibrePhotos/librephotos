import React, { Component } from "react";
import { Popup, Divider, Menu } from "semantic-ui-react";
import { connect } from "react-redux";
import { CountStats } from "../../components/statistics";
import WordCloud from "../../components/charts/wordCloud";
import { LocationLink } from "../../components/locationLink";
import { AlbumPlace } from "../albums/AlbumPlace";
import EventCountMonthGraph from "../../components/eventCountMonthGraph";
import LocationDurationStackedBar from "../../components/locationDurationStackedBar";
import FaceClusterScatter from "../../components/faceClusterGraph";
import SocialGraph from "../../components/socialGraph";
import { withTranslation } from "react-i18next";
import { compose } from "redux";
export class Statistics extends Component {
  state = { activeItem: "location tree" };

  handleItemClick = (e, { name }) => this.setState({ activeItem: name });

  render() {
    const { activeItem } = this.state;

    return (
      <div style={{ padding: 10 }}>
        <CountStats />

        <div>
          <Menu stackable={false} pointing secondary widths={5}>
            <Popup
              inverted
              position="bottom center"
              content={this.props.t("placetree")}
              trigger={
                <Menu.Item
                  icon="sitemap"
                  active={activeItem === "location tree"}
                  onClick={() => {
                    this.setState({ activeItem: "location tree" });
                  }}
                />
              }
            />
            <Popup
              inverted
              position="bottom center"
              content={this.props.t("wordclouds")}
              trigger={
                <Menu.Item
                  icon="cloud"
                  active={activeItem === "wordcloud"}
                  onClick={() => {
                    this.setState({ activeItem: "wordcloud" });
                  }}
                />
              }
            />
            <Popup
              inverted
              position="bottom center"
              content={this.props.t("timeline")}
              trigger={
                <Menu.Item
                  icon="area chart"
                  active={activeItem === "timeline"}
                  onClick={() => {
                    this.setState({ activeItem: "timeline" });
                  }}
                />
              }
            />
            <Popup
              inverted
              position="bottom center"
              content={this.props.t("socialgraph")}
              trigger={
                <Menu.Item
                  icon="share alternate"
                  active={activeItem === "social graph"}
                  onClick={() => {
                    this.setState({ activeItem: "social graph" });
                  }}
                />
              }
            />
            <Popup
              inverted
              position="bottom center"
              content={this.props.t("facecluster")}
              trigger={
                <Menu.Item
                  icon="user circle outline"
                  active={activeItem === "face clusters"}
                  onClick={() => {
                    this.setState({ activeItem: "face clusters" });
                  }}
                />
              }
            />
          </Menu>
        </div>

        {activeItem === "location tree" && (
          <div>
            <Divider hidden />
            <LocationLink
              width={window.innerWidth - 120}
              height={window.innerHeight - 50}
            />
          </div>
        )}

        {activeItem === "map" && (
          <div style={{ paddingTop: 10 }}>
            <AlbumPlace height={window.innerHeight - 250} />
          </div>
        )}

        {activeItem === "wordcloud" && (
          <div>
            <Divider hidden />
            <WordCloud height={320} type="location" />
            <Divider hidden />
            <WordCloud height={320} type="captions" />
            <Divider hidden />
            <WordCloud height={320} type="people" />
          </div>
        )}

        {activeItem === "timeline" && (
          <div>
            <Divider hidden />
            <EventCountMonthGraph />
            <Divider hidden />
            <LocationDurationStackedBar />
          </div>
        )}

        {activeItem === "social graph" && (
          <div>
            <Divider hidden />
            <SocialGraph height={window.innerHeight - 300} />
          </div>
        )}

        {activeItem === "face clusters" && (
          <div>
            <Divider hidden />
            <FaceClusterScatter height={window.innerHeight - 320} />
          </div>
        )}
      </div>
    );
  }
}

Statistics = compose(
  connect((store) => {
    return {
      statusPhotoScan: store.util.statusPhotoScan,
      statusAutoAlbumProcessing: store.util.statusAutoAlbumProcessing,
      generatingAlbumsAuto: store.albums.generatingAlbumsAuto,
      scanningPhotos: store.photos.scanningPhotos,
      fetchedCountStats: store.util.fetchedCountStats,
    };
  }),
  withTranslation()
)(Statistics);
