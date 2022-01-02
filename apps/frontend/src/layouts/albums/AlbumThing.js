import React, { Component } from "react";
import { connect } from "react-redux";
import { Icon, Header, Loader } from "semantic-ui-react";
import { Grid, AutoSizer } from "react-virtualized";
import { fetchThingAlbumsList } from "../../actions/albumsActions";
import { Tile } from "../../components/Tile";
import { Link } from "react-router-dom";
import { TOP_MENU_HEIGHT } from "../../ui-constants";
import { compose } from "redux";
import { withTranslation } from "react-i18next";

var SIDEBAR_WIDTH = 85;

export class AlbumThing extends Component {
  constructor() {
    super();
    this.state = {
      width: window.innerWidth,
      height: window.innerHeight,
      entrySquareSize: 200,
      numEntrySquaresPerRow: 0,
    };
  }

  componentDidMount() {
    this.calculateEntrySquareSize = this.calculateEntrySquareSize.bind(this);
    this.calculateEntrySquareSize();
    window.addEventListener("resize", this.calculateEntrySquareSize);
    if (this.props.albumsThingList.length === 0) {
      this.props.dispatch(fetchThingAlbumsList());
    }
    this.cellRenderer = this.cellRenderer.bind(this);
  }

  componentWillUnount() {
    window.removeEventListener("resize", this.calculateEntrySquareSize);
  }

  calculateEntrySquareSize() {
    var numEntrySquaresPerRow = 6;
    if (window.innerWidth < 600) {
      numEntrySquaresPerRow = 2;
    } else if (window.innerWidth < 800) {
      numEntrySquaresPerRow = 3;
    } else if (window.innerWidth < 1000) {
      numEntrySquaresPerRow = 4;
    } else if (window.innerWidth < 1200) {
      numEntrySquaresPerRow = 5;
    }

    var columnWidth = window.innerWidth - SIDEBAR_WIDTH - 5 - 5 - 15;

    var entrySquareSize = columnWidth / numEntrySquaresPerRow;
    this.setState({
      width: window.innerWidth,
      height: window.innerHeight,
      entrySquareSize: entrySquareSize,
      numEntrySquaresPerRow: numEntrySquaresPerRow,
    });
  }

  cellRenderer = ({ columnIndex, key, rowIndex, style }) => {
    var albumThingIndex =
      rowIndex * this.state.numEntrySquaresPerRow + columnIndex;
    if (albumThingIndex < this.props.albumsThingList.length) {
      return (
        <div key={key} style={style}>
          {this.props.albumsThingList[albumThingIndex].cover_photos
            .slice(0, 1)
            .map((photo) => {
              return (
                <Link
                  key={this.props.albumsThingList[albumThingIndex].id}
                  to={`/thing/${this.props.albumsThingList[albumThingIndex].id}/`}
                >
                  <Tile
                    video={photo.video === true}
                    height={this.state.entrySquareSize - 10}
                    width={this.state.entrySquareSize - 10}
                    image_hash={photo.image_hash}
                  ></Tile>
                </Link>
              );
            })}
          <div style={{ paddingLeft: 15, paddingRight: 15, height: 50 }}>
            <b>{this.props.albumsThingList[albumThingIndex].title}</b>
            <br />
            {this.props.t("numberofphotos", {
              number: this.props.albumsThingList[albumThingIndex].photo_count,
            })}
          </div>
        </div>
      );
    } else {
      return <div key={key} style={style} />;
    }
  };

  render() {
    return (
      <div>
        <div style={{ height: 60, paddingTop: 10 }}>
          <Header as="h2">
            <Icon name="tags" />
            <Header.Content>
              {this.props.t("things")}{" "}
              <Loader
                size="tiny"
                inline
                active={this.props.fetchingAlbumsThingList}
              />
              <Header.Subheader>
                {this.props.t("thingalbum.showingthings", {
                  number: this.props.albumsThingList.length,
                })}
              </Header.Subheader>
            </Header.Content>
          </Header>
        </div>

        <AutoSizer
          disableHeight
          style={{ outline: "none", padding: 0, margin: 0 }}
        >
          {({ width }) => (
            <Grid
              style={{ outline: "none" }}
              disableHeader={false}
              cellRenderer={this.cellRenderer}
              columnWidth={this.state.entrySquareSize}
              columnCount={this.state.numEntrySquaresPerRow}
              height={this.state.height - TOP_MENU_HEIGHT - 60}
              rowHeight={this.state.entrySquareSize + 60}
              rowCount={Math.ceil(
                this.props.albumsThingList.length /
                  this.state.numEntrySquaresPerRow.toFixed(1)
              )}
              width={width}
            />
          )}
        </AutoSizer>
      </div>
    );
  }
}

AlbumThing = compose(
  connect((store) => {
    return {
      albumsThingList: store.albums.albumsThingList,
      fetchingAlbumsThingList: store.albums.fetchingAlbumsThingList,
      fetchedAlbumsThingList: store.albums.fetchedAlbumsThingList,
    };
  }),
  withTranslation()
)(AlbumThing);
