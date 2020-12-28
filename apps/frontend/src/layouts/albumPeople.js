import React, { Component } from "react";
import { connect } from "react-redux";
import { fetchPeopleAlbums } from "../actions/albumsActions";
import {
  Popup,
  Icon,
  Divider,
  Header,
  Image,
  Loader,
  Button
} from "semantic-ui-react";
import { fetchPeople, deletePerson } from "../actions/peopleActions";
import { serverAddress } from "../api_client/apiClient";
import { Grid, AutoSizer } from "react-virtualized";
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

export class AlbumPeople extends Component {
  constructor(props) {
    super(props);

    this.calculateEntrySquareSize = this.calculateEntrySquareSize.bind(this);
    this.cellRenderer = this.cellRenderer.bind(this);
  }

  state = {
    width: window.innerWidth,
    height: window.innerHeight,
    entrySquareSize: 200
  };

  componentWillMount() {
    this.calculateEntrySquareSize();
    window.addEventListener("resize", this.calculateEntrySquareSize);
    if (this.props.people.length === 0) {
      this.props.dispatch(fetchPeople());
    }
  }

  componentWillUnmount() {
    window.removeEventListener("resize", this.calculateEntrySquareSize);
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
    var albumPersonIndex =
      rowIndex * this.state.numEntrySquaresPerRow + columnIndex;
    if (albumPersonIndex < this.props.people.length) {
      return (
        <div key={key} style={style}>
          <div
            onClick={() => {
              if (
                !this.props.albumsPeople.hasOwnProperty(
                  this.props.people[albumPersonIndex].key
                )
              ) {
                this.props.dispatch(
                  fetchPeopleAlbums(this.props.people[albumPersonIndex].key)
                );
              }
              // this.props.dispatch(push(`/person/${this.props.people[albumPersonIndex].key}`))
            }}
            style={{ padding: 5 }}
          >
            {this.props.people[albumPersonIndex].face_count > 0 ? (
              this.props.people[albumPersonIndex].text === "unknown" ? (
                <Image
                  label={{ as: "a", corner: "left", icon: "user circle" }}
                  height={this.state.entrySquareSize - 10}
                  width={this.state.entrySquareSize - 10}
                  as={Link}
                  to={`/person/${this.props.people[albumPersonIndex].key}`}
                  src={'/unknown_user.jpg'}
                />
              ) : (
                <SecuredImageJWT
                  label={{ as: "a", corner: "left", icon: "user circle" }}
                  height={this.state.entrySquareSize - 10}
                  width={this.state.entrySquareSize - 10}
                  as={Link}
                  to={`/person/${this.props.people[albumPersonIndex].key}`}
                  src={
                    serverAddress +
                    this.props.people[albumPersonIndex].face_photo_url
                  }
                />
              )
            ) : (
              <Image
                height={this.state.entrySquareSize - 10}
                width={this.state.entrySquareSize - 10}
                src={"/unknown_user.jpg"}
              />
            )}
          </div>
          <div
            className="personCardName"
            style={{ paddingLeft: 15, paddingRight: 15, height: 50 }}
          >
            <b>{this.props.people[albumPersonIndex].text}</b> <br />
            {this.props.people[albumPersonIndex].face_count} Photos
            {this.props.people[albumPersonIndex].text.toLowerCase() !=
              "unknown" && (
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
                      <b>{this.props.people[albumPersonIndex].text}</b>?<br />
                      This action cannot be undone!<br />
                      All the faces associated with this person will be tagged{" "}
                      <i>unknown</i>.
                      <Divider />
                      <div>
                        <Button
                          onClick={() =>
                            this.props.dispatch(
                              deletePerson(
                                this.props.people[albumPersonIndex].key
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
                  on="click"
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
            <Icon name="users" />
            <Header.Content>
              People{" "}
              <Loader size="tiny" inline active={this.props.fetchingPeople} />
              <Header.Subheader>
                {this.props.people.length} People
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
              headerHeight={100}
              disableHeader={false}
              cellRenderer={this.cellRenderer}
              columnWidth={this.state.entrySquareSize}
              columnCount={this.state.numEntrySquaresPerRow}
              height={this.state.height - topMenuHeight - 60}
              rowHeight={this.state.entrySquareSize + 60}
              rowCount={Math.ceil(
                this.props.people.length /
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

AlbumPeople = connect(store => {
  return {
    albumsPeople: store.albums.albumsPeople,
    fetchingAlbumsPeople: store.albums.fetchingAlbumsPeople,
    fetchedAlbumsPeople: store.albums.fetchedAlbumsPeople,
    people: store.people.people,
    fetchedPeople: store.people.fetched,
    fetchingPeople: store.people.fetching
  };
})(AlbumPeople);
