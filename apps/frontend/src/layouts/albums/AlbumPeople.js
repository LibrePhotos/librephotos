import React, { Component } from "react";
import { connect } from "react-redux";
import {
  Popup,
  Icon,
  Modal,
  Input,
  Confirm,
  Header,
  Image,
  Loader,
  Button,
  Dropdown,
  Label,
} from "semantic-ui-react";
import {
  fetchPeople,
  deletePerson,
  renamePerson,
} from "../../actions/peopleActions";
import { Tile } from "../../components/Tile";
import { Grid, AutoSizer } from "react-virtualized";
import { Link } from "react-router-dom";
import { TOP_MENU_HEIGHT } from "../../ui-constants";
import { compose } from "redux";
import { withTranslation, Trans } from "react-i18next";

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
    entrySquareSize: 200,
    numEntrySquaresPerRow: 0,
    openDeleteDialog: false,
    openRenameDialog: false,
    personID: "",
    personName: "",
    newPersonName: "",
  };

  openDeleteDialog = (personID, personName) =>
    this.setState({
      openDeleteDialog: true,
      personID: personID,
      personName: personName,
    });
  openRenameDialog = (personID, personName) =>
    this.setState({
      openRenameDialog: true,
      personID: personID,
      personName: personName,
    });
  closeDeleteDialog = () => this.setState({ openDeleteDialog: false });
  closeRenameDialog = () => this.setState({ openRenameDialog: false });

  componentDidMount() {
    this.calculateEntrySquareSize();
    window.addEventListener("resize", this.calculateEntrySquareSize);
    if (this.props.people.length === 0) {
      fetchPeople(this.props.dispatch);
    }
  }

  componentWillUnmount() {
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
    var albumPersonIndex =
      rowIndex * this.state.numEntrySquaresPerRow + columnIndex;
    if (albumPersonIndex < this.props.people.length) {
      return (
        <div key={key} style={style}>
          <div style={{ padding: 5 }}>
            {this.props.people[albumPersonIndex].face_count > 0 ? (
              this.props.people[albumPersonIndex].text === "unknown" ? (
                <Image
                  height={this.state.entrySquareSize - 10}
                  width={this.state.entrySquareSize - 10}
                  as={Link}
                  to={`/person/${this.props.people[albumPersonIndex].key}`}
                  src={"/unknown_user.jpg"}
                />
              ) : (
                <Link to={`/person/${this.props.people[albumPersonIndex].key}`}>
                  <Tile
                    video={this.props.people[albumPersonIndex].video === true}
                    height={this.state.entrySquareSize - 10}
                    width={this.state.entrySquareSize - 10}
                    image_hash={
                      this.props.people[albumPersonIndex].face_photo_url
                    }
                  ></Tile>
                </Link>
              )
            ) : (
              <Image
                height={this.state.entrySquareSize - 10}
                width={this.state.entrySquareSize - 10}
                src={"/unknown_user.jpg"}
              />
            )}
            <Label
              style={{ backgroundColor: "transparent" }}
              attached="top right"
            >
              <Dropdown
                item
                icon={<Icon color="black" name="ellipsis vertical"></Icon>}
              >
                <Dropdown.Menu>
                  <Dropdown.Item
                    icon="edit"
                    onClick={() =>
                      this.openRenameDialog(
                        this.props.people[albumPersonIndex].key,
                        this.props.people[albumPersonIndex].text
                      )
                    }
                    text={this.props.t("rename")}
                  />
                  <Dropdown.Item
                    icon="delete"
                    onClick={() => {
                      this.openDeleteDialog(
                        this.props.people[albumPersonIndex].key,
                        this.props.people[albumPersonIndex].text
                      );
                    }}
                    text={this.props.t("delete")}
                  />
                </Dropdown.Menu>
              </Dropdown>
            </Label>
          </div>
          <div
            className="personCardName"
            style={{ paddingLeft: 15, paddingRight: 15, height: 50 }}
          >
            <b>{this.props.people[albumPersonIndex].text}</b> <br />
            {this.props.t("numberofphotos", {
              number: this.props.people[albumPersonIndex].face_count,
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
            <Icon name="users" />
            <Header.Content>
              {this.props.t("people")}{" "}
              <Loader size="tiny" inline active={this.props.fetchingPeople} />
              <Header.Subheader>
                {this.props.t("personalbum.numberofpeople", {
                  peoplelength: this.props.people.length,
                })}
              </Header.Subheader>
            </Header.Content>
          </Header>
        </div>
        <Modal
          size={"mini"}
          onClose={() => this.closeRenameDialog()}
          onOpen={() => this.openRenameDialog()}
          open={this.state.openRenameDialog}
        >
          <div style={{ padding: 20 }}>
            <Header as="h4">{this.props.t("personalbum.renameperson")}</Header>
            <Popup
              inverted
              content={this.props.t("personalbum.personalreadyexists", {
                name: this.state.newPersonName.trim(),
              })}
              position="bottom center"
              open={this.props.people
                .map((el) => el.text.toLowerCase().trim())
                .includes(this.state.newPersonName.toLowerCase().trim())}
              trigger={
                <Input
                  fluid
                  error={this.props.people
                    .map((el) => el.text.toLowerCase().trim())
                    .includes(this.state.newPersonName.toLowerCase().trim())}
                  onChange={(e, v) => {
                    this.setState({ newPersonName: v.value });
                  }}
                  placeholder={this.props.t("personalbum.nameplaceholder")}
                  action
                >
                  <input />
                  <Button
                    positive
                    onClick={() => {
                      this.props.dispatch(
                        renamePerson(
                          this.state.personID,
                          this.state.personName,
                          this.state.newPersonName
                        )
                      );
                      this.closeRenameDialog();
                    }}
                    disabled={this.props.people
                      .map((el) => el.text.toLowerCase().trim())
                      .includes(this.state.newPersonName.toLowerCase().trim())}
                    type="submit"
                  >
                    {this.props.t("rename")}
                  </Button>
                </Input>
              }
            />
          </div>
        </Modal>
        <Confirm
          open={this.state.openDeleteDialog}
          onCancel={this.closeDeleteDialog}
          onConfirm={() => {
            this.props.dispatch(deletePerson(this.state.personID));
            this.closeDeleteDialog();
          }}
        />
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
              height={this.state.height - TOP_MENU_HEIGHT - 60}
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

AlbumPeople = compose(
  connect((store) => {
    return {
      albumsPeople: store.albums.albumsPeople,
      fetchingAlbumsPeople: store.albums.fetchingAlbumsPeople,
      fetchedAlbumsPeople: store.albums.fetchedAlbumsPeople,
      people: store.people.people,
      fetchedPeople: store.people.fetched,
      fetchingPeople: store.people.fetching,
    };
  }),
  withTranslation()
)(AlbumPeople);
