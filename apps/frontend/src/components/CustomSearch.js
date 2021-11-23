import _ from "lodash";
import React, { Component } from "react";
import { connect } from "react-redux";
import { push } from "connected-react-router";
import "./menubars/TopMenu.css";
import { Icon, Image, Search, Popup, Segment, Loader } from "semantic-ui-react";
import {
  fetchPersonPhotos,
  fetchPlaceAlbum,
  fetchPlaceAlbumsList,
  fetchThingAlbumsList,
  fetchUserAlbum,
  fetchUserAlbumsList,
} from "../actions/albumsActions";
import { fetchPeople } from "../actions/peopleActions";
import {
  searchPeople,
  searchPhotos,
  searchPlaceAlbums,
  searchThingAlbums,
} from "../actions/searchActions";
import { fetchExampleSearchTerms } from "../actions/utilActions";
import { serverAddress } from "../api_client/apiClient";
import { SecuredImageJWT } from "./SecuredImage";
import { TOP_MENU_HEIGHT } from "../ui-constants";

var ENTER_KEY = 13;

function fuzzy_match(str, pattern) {
  if (pattern.split("").length > 0) {
    pattern = pattern.split("").reduce(function (a, b) {
      return a + ".*" + b;
    });
    return new RegExp(pattern).test(str);
  } else {
    return false;
  }
}

export class CustomSearch extends Component {
  state = {
    searchText: "",
    warningPopupOpen: false,
    showEmptyQueryWarning: false,
    width: window.innerWidth,
    exampleSearchTerm: "Search...",
    searchBarFocused: false,
    filteredExampleSearchTerms: [],
    filteredSuggestedPeople: [],
  };

  constructor(props) {
    super(props);
    this.handleSearch = this.handleSearch.bind(this);
    this.handleChange = this.handleChange.bind(this);
    this.handleResize = this.handleResize.bind(this);
    this._handleKeyDown = this._handleKeyDown.bind(this);
    this.filterSearchSuggestions = this.filterSearchSuggestions.bind(this);
  }

  handleResize() {
    this.setState({ width: window.innerWidth });
  }

  componentDidMount() {
    this.props.dispatch(fetchExampleSearchTerms());
    window.addEventListener("resize", this.handleResize.bind(this));
    this.exampleSearchTermCylcer = setInterval(() => {
      this.setState({
        exampleSearchTerm:
          "Search " +
          this.props.exampleSearchTerms[
            Math.floor(Math.random() * this.props.exampleSearchTerms.length)
          ],
      });
    }, 5000);
  }

  static getDerivedStateFromProps(nextProps, prevState) {
    if (prevState.searchText.trim().length === 0) {
      var filteredExampleSearchTerms = [];
      var filteredSuggestedPeople = [];
      var filteredSuggestedPlaces = [];
      var filteredSuggestedThings = [];
      var filteredSuggestedUserAlbums = [];
    } else {
      filteredExampleSearchTerms = nextProps.exampleSearchTerms.filter((el) =>
        fuzzy_match(el.toLowerCase(), prevState.searchText.toLowerCase())
      );
      filteredSuggestedPeople = nextProps.people.filter((person) =>
        fuzzy_match(
          person.text.toLowerCase(),
          prevState.searchText.toLowerCase()
        )
      );
      filteredSuggestedPlaces = nextProps.albumsPlaceList.filter((place) =>
        fuzzy_match(
          place.title.toLowerCase(),
          prevState.searchText.toLowerCase()
        )
      );
      filteredSuggestedThings = nextProps.albumsThingList.filter((thing) =>
        fuzzy_match(
          thing.title.toLowerCase(),
          prevState.searchText.toLowerCase()
        )
      );
      filteredSuggestedUserAlbums = nextProps.albumsUserList.filter((album) =>
        fuzzy_match(
          album.title.toLowerCase(),
          prevState.searchText.toLowerCase()
        )
      );
    }
    return {
      ...prevState,
      filteredSuggestedPeople,
      filteredExampleSearchTerms,
      filteredSuggestedPlaces,
      filteredSuggestedThings,
      filteredSuggestedUserAlbums,
    };
  }

  componentWillUnmount() {
    window.removeEventListener("resize", this.handleResize.bind(this));
    clearInterval(this.state.intervalId);
  }

  _handleKeyDown(event) {
    switch (event.keyCode) {
      case ENTER_KEY:
        this.props.dispatch(searchPhotos(this.state.searchText));
        this.props.dispatch(push("/search"));
        break;
      default:
        break;
    }
  }

  filterSearchSuggestions() {
    if (this.props.people.length == 0) {
      this.props.dispatch(fetchPeople());
    }
    if (this.props.albumsPlaceList.length == 0) {
      this.props.dispatch(fetchPlaceAlbumsList());
    }
    if (this.props.albumsThingList.length == 0) {
      this.props.dispatch(fetchThingAlbumsList());
    }
    if (this.props.albumsUserList.length == 0) {
      this.props.dispatch(fetchUserAlbumsList());
    }

    if (this.state.searchText.trim().length === 0) {
      var filteredExampleSearchTerms = [];
      var filteredSuggestedPeople = [];
      var filteredSuggestedPlaces = [];
      var filteredSuggestedThings = [];
      var filteredSuggestedUserAlbums = [];
    } else {
      filteredExampleSearchTerms = this.props.exampleSearchTerms.filter((el) =>
        fuzzy_match(el.toLowerCase(), this.state.searchText.toLowerCase())
      );
      filteredSuggestedPeople = this.props.people.filter((person) =>
        fuzzy_match(
          person.text.toLowerCase(),
          this.state.searchText.toLowerCase()
        )
      );
      filteredSuggestedPlaces = this.props.albumsPlaceList.filter((place) =>
        fuzzy_match(
          place.title.toLowerCase(),
          this.state.searchText.toLowerCase()
        )
      );
      filteredSuggestedThings = this.props.albumsThingList.filter((thing) =>
        fuzzy_match(
          thing.title.toLowerCase(),
          this.state.searchText.toLowerCase()
        )
      );
      filteredSuggestedUserAlbums = this.props.albumsUserList.filter((album) =>
        fuzzy_match(
          album.title.toLowerCase(),
          this.state.searchText.toLowerCase()
        )
      );
    }
    this.setState({
      filteredSuggestedPeople,
      filteredExampleSearchTerms,
      filteredSuggestedPlaces,
      filteredSuggestedThings,
      filteredSuggestedUserAlbums,
    });
  }

  handleSearch(e, d) {
    if (this.state.searchText.length > 0) {
      this.props.dispatch(searchPhotos(this.state.searchText));
      this.props.dispatch(searchPeople(this.state.searchText));
      this.props.dispatch(searchThingAlbums(this.state.searchText));
      this.props.dispatch(searchPlaceAlbums(this.state.searchText));
      this.props.dispatch(push("/search"));
    } else {
      this.setState({ warningPopupOpen: true, showEmptyQueryWarning: true });
      this.timeout = setTimeout(() => {
        this.setState({ warningPopupOpen: false, showEmptyQueryWarning: true });
      }, 2500);
    }
  }

  handleChange(e, d) {
    this.setState({ searchText: d.value });
    this.filterSearchSuggestions();
  }

  render() {
    var searchBarWidth = this.state.width - this.state.width / 2.7;

    const {
      filteredSuggestedUserAlbums,
      filteredExampleSearchTerms,
      filteredSuggestedPeople,
      filteredSuggestedPlaces,
      filteredSuggestedThings,
    } = this.state;

    return (
      <div className="element">
        <Search
          className="header"
          open={false}
          input={{ className: "element" }}
          onFocus={() => {
            this.setState({ searchBarFocused: true });
          }}
          onBlur={() => {
            _.debounce(() => {
              this.setState({ searchBarFocused: false });
            }, 200)();
          }}
          onKeyDown={(event) => {
            switch (event.keyCode) {
              case ENTER_KEY:
                this.props.dispatch(searchPhotos(this.state.searchText));
                this.props.dispatch(push("/search"));
                this.setState({ searchBarFocused: false });
                break;
              default:
                break;
            }
          }}
          onSearchChange={this.handleChange}
          placeholder={this.state.exampleSearchTerm}
        />
        {this.state.searchBarFocused && (
          <div
            style={{
              width: searchBarWidth,
              textAlign: "left",
              zIndex: 120,
              top: TOP_MENU_HEIGHT,
              left: (this.state.width - searchBarWidth) / 2,
              position: "absolute",
            }}
          >
            {filteredExampleSearchTerms.length > 0 && (
              <Segment
                attached
                textAlign="left"
                style={{ paddingTop: 0, paddingRight: 0, paddingBottom: 0 }}
              >
                <div
                  style={{
                    maxHeight: window.innerHeight / 5,
                    overflowY: "auto",
                  }}
                >
                  <div style={{ height: 10 }} />
                  {filteredExampleSearchTerms.slice(0, 2).map((el) => {
                    return (
                      <p
                        key={"suggestion_" + el}
                        onClick={() => {
                          this.props.dispatch(searchPhotos(el));
                          this.props.dispatch(searchPeople(el));
                          this.props.dispatch(searchThingAlbums(el));
                          this.props.dispatch(searchPlaceAlbums(el));
                          this.props.dispatch(push("/search"));
                        }}
                      >
                        <Icon name="search" />
                        {el}
                      </p>
                    );
                  })}
                  <div style={{ height: 5 }} />
                </div>
              </Segment>
            )}
            {filteredSuggestedUserAlbums.length > 0 && (
              <Segment
                attached
                textAlign="left"
                style={{ paddingTop: 0, paddingRight: 0, paddingBottom: 0 }}
              >
                <div
                  style={{
                    maxHeight: window.innerHeight / 5,
                    overflowY: "auto",
                  }}
                >
                  <div style={{ height: 10 }} />
                  {filteredSuggestedUserAlbums.slice(0, 2).map((album) => {
                    return (
                      <p
                        key={"suggestion_place_" + album.title}
                        onClick={() => {
                          this.props.dispatch(push(`/useralbum/${album.id}`));
                          this.props.dispatch(fetchUserAlbum(album.id));
                        }}
                      >
                        <Icon name="bookmark" />
                        {album.title}
                      </p>
                    );
                  })}
                  <div style={{ height: 5 }} />
                </div>
              </Segment>
            )}
            {filteredSuggestedPlaces.length > 0 && (
              <Segment
                attached
                textAlign="left"
                style={{ paddingTop: 0, paddingRight: 0, paddingBottom: 0 }}
              >
                <div
                  style={{
                    maxHeight: window.innerHeight / 5,
                    overflowY: "auto",
                  }}
                >
                  <div style={{ height: 10 }} />
                  {filteredSuggestedPlaces.slice(0, 2).map((place) => {
                    return (
                      <p
                        key={"suggestion_place_" + place.title}
                        onClick={() => {
                          this.props.dispatch(push(`/place/${place.id}`));
                          this.props.dispatch(fetchPlaceAlbum(place.id));
                        }}
                      >
                        <Icon name="map outline" />
                        {place.title}
                      </p>
                    );
                  })}
                  <div style={{ height: 5 }} />
                </div>
              </Segment>
            )}
            {filteredSuggestedThings.length > 0 && (
              <Segment
                attached
                textAlign="left"
                style={{ paddingTop: 0, paddingRight: 0, paddingBottom: 0 }}
              >
                <div
                  style={{
                    maxHeight: window.innerHeight / 5,
                    overflowY: "auto",
                  }}
                >
                  <div style={{ height: 10 }} />
                  {filteredSuggestedThings.slice(0, 2).map((thing) => {
                    return (
                      <p
                        key={"suggestion_thing_" + thing.title}
                        onClick={() => {
                          this.props.dispatch(push(`/search`));
                          this.props.dispatch(searchPhotos(thing.title));
                        }}
                      >
                        <Icon name="tag" />
                        {thing.title}
                      </p>
                    );
                  })}
                  <div style={{ height: 5 }} />
                </div>
              </Segment>
            )}
            {filteredSuggestedPeople.length > 0 && (
              <Segment attached style={{ padding: 0 }}>
                <div
                  style={{
                    maxWidth: searchBarWidth - 5,
                    height: 60,
                    padding: 5,
                    overflow: "hidden",
                  }}
                >
                  <Image.Group>
                    {filteredSuggestedPeople.map((person) => {
                      return (
                        <Popup
                          inverted
                          content={person.text}
                          trigger={
                            <SecuredImageJWT
                              key={"suggestion_person_" + person.key}
                              onClick={() => {
                                this.props.dispatch(
                                  push(`/person/${person.key}`)
                                );
                                this.props.dispatch(
                                  fetchPersonPhotos(person.key)
                                );
                              }}
                              height={50}
                              width={50}
                              circular
                              src={serverAddress + person.face_url}
                            />
                          }
                        />
                      );
                    })}
                  </Image.Group>
                </div>
              </Segment>
            )}
            {this.props.albumsThingList.length == 0 &&
              this.state.searchText.length > 0 && (
                <Segment
                  attached
                  textAlign="left"
                  style={{ paddingTop: 0, paddingRight: 0, paddingBottom: 0 }}
                >
                  <div
                    style={{
                      maxHeight: window.innerHeight / 5,
                      overflowY: "auto",
                    }}
                  >
                    Loading...
                    <Loader inline active={true} size="mini" />
                  </div>
                </Segment>
              )}
          </div>
        )}
      </div>
    );
  }
}

CustomSearch = connect((store) => {
  return {
    exampleSearchTerms: store.util.exampleSearchTerms,
    people: store.people.people,
    albumsThingList: store.albums.albumsThingList,
    albumsUserList: store.albums.albumsUserList,
    albumsPlaceList: store.albums.albumsPlaceList,
  };
})(CustomSearch);
