import React, { Component } from "react";
import { connect } from "react-redux";
import {
  Icon,
  Header,
  Button,
  Loader,
  Popup,
  Image,
  Divider
} from "semantic-ui-react";
import { Grid, AutoSizer } from "react-virtualized";
import { serverAddress } from "../api_client/apiClient";
import LazyLoad from "react-lazyload";
import { fetchUserAlbumsList, deleteUserAlbum } from "../actions/albumsActions";
import { searchPhotos } from "../actions/searchActions";
import { push } from "react-router-redux";
import store from "../store";
import { Link } from "react-router-dom";
import { SecuredImageJWT } from "../components/SecuredImage";


var topMenuHeight = 45; // don't change this
var ESCAPE_KEY = 27;
var ENTER_KEY = 13;
var RIGHT_ARROW_KEY = 39;
var UP_ARROW_KEY = 38;
var LEFT_ARROW_KEY = 37;
var DOWN_ARROW_KEY = 40;

var SIDEBAR_WIDTH = 85;

export class AlbumUser extends Component {
  constructor() {
    super();
    this.setState({
      width: window.innerWidth,
      height: window.innerHeight,
      entrySquareSize: 200
    });
    this.calculateEntrySquareSize = this.calculateEntrySquareSize.bind(this);
    this.cellRenderer = this.cellRenderer.bind(this);
  }

  componentWillMount() {
    this.calculateEntrySquareSize();
    window.addEventListener("resize", this.calculateEntrySquareSize.bind(this));
    if (this.props.albumsUserList.length === 0) {
      this.props.dispatch(fetchUserAlbumsList());
    }
  }

  calculateEntrySquareSize() {
    if (window.innerWidth < 600) {
      var numEntrySquaresPerRow = 2;
    } else if (window.innerWidth < 800) {
      var numEntrySquaresPerRow = 3;
    } else if (window.innerWidth < 1000) {
      var numEntrySquaresPerRow = 4;
    } else if (window.innerWidth < 1200) {
      var numEntrySquaresPerRow = 5;
    } else {
      var numEntrySquaresPerRow = 6;
    }

    var columnWidth = window.innerWidth - SIDEBAR_WIDTH - 5 - 5 - 15;

    var entrySquareSize = columnWidth / numEntrySquaresPerRow;
    var numEntrySquaresPerRow = numEntrySquaresPerRow;
    this.setState({
      width: window.innerWidth,
      height: window.innerHeight,
      entrySquareSize: entrySquareSize,
      numEntrySquaresPerRow: numEntrySquaresPerRow
    });
  }

  cellRenderer = ({ columnIndex, key, rowIndex, style }) => {
    var albumUserIndex =
      rowIndex * this.state.numEntrySquaresPerRow + columnIndex;
    if (albumUserIndex < this.props.albumsUserList.length) {
      return (
        <div key={key} style={style}>
          <div
            onClick={() => {
                //todo
            }}
            style={{ padding: 5 }}
          >
            <SecuredImageJWT
              label={{ as: 'a', corner: 'left', icon: 'bookmark', color: 'red' }}
              style={{ display: "inline-block" }}
              as={Link}
              to={`/useralbum/${this.props.albumsUserList[albumUserIndex].id}`}
              width={this.state.entrySquareSize - 10}
              height={this.state.entrySquareSize - 10}
              src={
                serverAddress +
                "/media/square_thumbnails/" +
                this.props.albumsUserList[albumUserIndex].cover_photos[0]
                  .image_hash +
                ".jpg"
              }
            />
          </div>
          <div
            className="personCardName"
            style={{ paddingLeft: 15, paddingRight: 15, height: 50 }}
          >
            
            {
              this.props.albumsUserList[albumUserIndex].shared_to.length>0 && 
              <Popup 
                style={{padding:10}}
                size='tiny'
                position='center right'
                header='Shared with:'
                trigger={<Icon name='users'/>}
                content={
                  this.props.albumsUserList[albumUserIndex].shared_to.map(el=>{
                    return <div><Icon name='user circle'/><b>{el.username}</b></div>
                  })
                }/>

            }
            <b>{this.props.albumsUserList[albumUserIndex].title}</b> <br />
            {this.props.albumsUserList[albumUserIndex].photo_count} Photo(s)
            {true && (
              <div
                className="personRemoveButton"
                style={{ right: 0, position: "absolute" }}
              >
                <Popup
                  wide="very"
                  hoverable
                  flowing
                  trigger={<Icon color="grey" name="remove" />}
                  content={
                    <div style={{ textAlign: "center" }}>
                      Are you sure you want to delete{" "}
                      <b>{this.props.albumsUserList[albumUserIndex].title}</b>?<br />
                      This action cannot be undone!<br />
                      <Divider />
                      <div>
                        <Button
                          onClick={() =>
                            this.props.dispatch(
                              deleteUserAlbum(
                                this.props.albumsUserList[albumUserIndex].id,
                                this.props.albumsUserList[albumUserIndex].title
                              )
                            )
                          }
                          negative
                        >
                          Yes
                        </Button>
                      </div>
                    </div>
                  }
                  on="focus"
                  position="bottom center"
                />
              </div>
            )}
          </div>
        </div>
      );
    } else {
      return <div key={key} style={style} />;
    }
  };

  render() {
    var entrySquareSize = this.state.entrySquareSize;
    var numEntrySquaresPerRow = this.state.numEntrySquaresPerRow;
    return (
      <div>
        <div style={{ height: 60, paddingTop: 10 }}>
          <Header as="h2">
            <Icon name="bookmark" />
            <Header.Content>
              My Albums{" "}
              <Loader
                size="tiny"
                inline
                active={this.props.fetchingAlbumsUserList}
              />
              <Header.Subheader>
                Showing {this.props.albumsUserList.length} user created albums
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
              height={this.state.height - topMenuHeight - 60}
              rowHeight={this.state.entrySquareSize + 60}
              rowCount={Math.ceil(
                this.props.albumsUserList.length /
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

export class EntrySquare extends Component {
  render() {
    var images = this.props.cover_photos.map(function(photo) {
      return (
        <SecuredImageJWT
          style={{ display: "inline-block" }}
          width={this.props.size / 2 - 20}
          height={this.props.size / 2 - 20}
          src={
            serverAddress +
            "/media/square_thumbnails/" +
            photo.image_hash +
            ".jpg"
          }
        />
      );
    }, this);
    return (
      <div
        style={{
          width: this.props.size,
          display: "inline-block",
          paddingLeft: 10,
          paddingRight: 10
        }}
        onClick={() => {
          store.dispatch(searchPhotos(this.props.title));
          store.dispatch(push("/search"));
        }}
      >
        <div style={{ height: this.props.size }}>
          <LazyLoad
            once={true}
            unmountIfInvisible={true}
            height={this.props.size}
          >
            <Image.Group>{images}</Image.Group>
          </LazyLoad>
        </div>
        <div style={{ height: 100 }}>
          <b>{this.props.title}</b> ({this.props.photoCount})
        </div>
      </div>
    );
  }
}

AlbumUser = connect(store => {
  return {
    albumsUserList: store.albums.albumsUserList,
    fetchingAlbumsUserList: store.albums.fetchingAlbumsUserList,
    fetchedAlbumsUserList: store.albums.fetchedAlbumsUserList
  };
})(AlbumUser);
