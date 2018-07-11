import _ from "lodash";
import React, { Component } from "react";
import { connect } from "react-redux";
import { Link } from "react-router-dom";
import { push } from "react-router-redux";
import {
  Button,
  Divider,
  Dropdown,
  Header,
  Icon,
  Image,
  Input,
  Menu,
  Popup,
  Segment,
  Sidebar
} from "semantic-ui-react";
import {
  fetchPeopleAlbums,
  fetchPlaceAlbum,
  fetchPlaceAlbumsList,
  fetchThingAlbumsList,
  fetchUserAlbum,
  fetchUserAlbumsList
} from "../actions/albumsActions";
import { logout } from "../actions/authActions";
import { fetchPeople } from "../actions/peopleActions";
import {
  searchPeople,
  searchPhotos,
  searchPlaceAlbums,
  searchThingAlbums
} from "../actions/searchActions";
import { toggleSidebar } from "../actions/uiActions";
import {
  fetchCountStats,
  fetchExampleSearchTerms,
  fetchWorkerAvailability
} from "../actions/utilActions";
import { serverAddress } from "../api_client/apiClient";
import { SecuredImageJWT } from "../components/SecuredImage";


var ENTER_KEY = 13;
var topMenuHeight = 45; // don't change this

function fuzzy_match(str, pattern) {
  if (pattern.split("").length > 0) {
    pattern = pattern.split("").reduce(function(a, b) {
      return a + ".*" + b;
    });
    return new RegExp(pattern).test(str);
  } else {
    return false;
  }
}

export class TopMenuPublic extends Component {
  render() {
    return (
      <div>
        <Menu
          style={{ contentAlign: "left", backgroundColor: "#eeeeee" }}
          borderless
          fixed="top"
          size="mini"
        >
          <Menu.Menu position="left">
            <Menu.Item>
              <Icon
                size="big"
                onClick={() => {
                  this.props.dispatch(toggleSidebar());
                }}
                name={"sidebar"}
              />
              <Button
                color="black"
                style={{
                  padding: 2
                }}
              >
                <Image height={30} src="/logo-white.png" />
              </Button>
            </Menu.Item>
          </Menu.Menu>

          <Menu.Item>
              <Button
                attached='left'
                onClick={() => {
                  this.props.dispatch({
                    type: "SET_GRID_TYPE",
                    payload: "dense"
                  });
                }}
                icon
                active={this.props.gridType === "dense"}
              >
                <Icon name="grid layout" />
              </Button>
              <Button
                attached='right'
                  onClick={() => {
                  this.props.dispatch({
                    type: "SET_GRID_TYPE",
                    payload: "loose"
                  });
                }}
                icon
                active={this.props.gridType === "loose"}
              >
                <Icon name="block layout" />
              </Button>
          </Menu.Item>

          <Menu.Item position="right">
            <Button as={Link} to="/login">
              Login
            </Button>
          </Menu.Item>
        </Menu>
      </div>
    );
  }
}

export class TopMenu extends Component {
  state = {
    searchText: "",
    warningPopupOpen: false,
    showEmptyQueryWarning: false,
    width: window.innerWidth,
    exampleSearchTerm: "Search...",
    searchBarFocused: false,
    filteredExampleSearchTerms: [],
    filteredSuggestedPeople: []
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
    this.props.dispatch(fetchPeople());
    this.props.dispatch(fetchPlaceAlbumsList());
    this.props.dispatch(fetchThingAlbumsList());
    this.props.dispatch(fetchUserAlbumsList());
    this.props.dispatch(fetchExampleSearchTerms());
    this.props.dispatch(fetchCountStats());
    window.addEventListener("resize", this.handleResize.bind(this));
    this.exampleSearchTermCylcer = setInterval(() => {
      this.setState({
        exampleSearchTerm:
          "Search " +
          this.props.exampleSearchTerms[
            Math.floor(Math.random() * this.props.exampleSearchTerms.length)
          ]
      });
    }, 5000);

    var _dispatch = this.props.dispatch;
    this.setState({ dispatch: _dispatch });
    var intervalId = setInterval(() => {
      _dispatch(fetchWorkerAvailability(this.props.workerRunningJob));
    }, 2000);
    this.setState({ intervalId: intervalId });
  }

  static getDerivedStateFromProps(nextProps, prevState) {
    if (prevState.searchText.trim().length === 0) {
      var filteredExampleSearchTerms = [];
      var filteredSuggestedPeople = [];
      var filteredSuggestedPlaces = [];
      var filteredSuggestedThings = [];
      var filteredSuggestedUserAlbums = [];
    } else {
      filteredExampleSearchTerms = nextProps.exampleSearchTerms.filter(el =>
        fuzzy_match(el.toLowerCase(), prevState.searchText.toLowerCase())
      );
      filteredSuggestedPeople = nextProps.people.filter(person =>
        fuzzy_match(
          person.text.toLowerCase(),
          prevState.searchText.toLowerCase()
        )
      );
      filteredSuggestedPlaces = nextProps.albumsPlaceList.filter(place =>
        fuzzy_match(
          place.title.toLowerCase(),
          prevState.searchText.toLowerCase()
        )
      );
      filteredSuggestedThings = nextProps.albumsThingList.filter(thing =>
        fuzzy_match(
          thing.title.toLowerCase(),
          prevState.searchText.toLowerCase()
        )
      );
      filteredSuggestedUserAlbums = nextProps.albumsUserList.filter(album =>
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
      filteredSuggestedUserAlbums
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
    if (this.state.searchText.trim().length === 0) {
      var filteredExampleSearchTerms = [];
      var filteredSuggestedPeople = [];
      var filteredSuggestedPlaces = [];
      var filteredSuggestedThings = [];
      var filteredSuggestedUserAlbums = [];
    } else {
      filteredExampleSearchTerms = this.props.exampleSearchTerms.filter(el =>
        fuzzy_match(el.toLowerCase(), this.state.searchText.toLowerCase())
      );
      filteredSuggestedPeople = this.props.people.filter(person =>
        fuzzy_match(
          person.text.toLowerCase(),
          this.state.searchText.toLowerCase()
        )
      );
      filteredSuggestedPlaces = this.props.albumsPlaceList.filter(place =>
        fuzzy_match(
          place.title.toLowerCase(),
          this.state.searchText.toLowerCase()
        )
      );
      filteredSuggestedThings = this.props.albumsThingList.filter(thing =>
        fuzzy_match(
          thing.title.toLowerCase(),
          this.state.searchText.toLowerCase()
        )
      );
      filteredSuggestedUserAlbums = this.props.albumsUserList.filter(album =>
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
      filteredSuggestedUserAlbums
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
    this.state.searchText = d.value;
    this.filterSearchSuggestions();
  }

  render() {
    var searchBarWidth =
      this.state.width > 600 ? this.state.width - 200 : this.state.width - 220;
    var searchBarWidth = this.state.width - 300;

    const {
      filteredSuggestedUserAlbums,
      filteredExampleSearchTerms,
      filteredSuggestedPeople,
      filteredSuggestedPlaces,
      filteredSuggestedThings
    } = this.state;

    // var searchBarWidth =  this.state.width - 130
    return (
      <div>
        <Menu
          style={{ contentAlign: "left", backgroundColor: "#eeeeee" }}
          borderless
          fixed="top"
          size="mini"
        >
          <Menu.Menu position="left">
            <Menu.Item>
              <Icon
                size="big"
                onClick={() => {
                  this.props.dispatch(toggleSidebar());
                }}
                name={"sidebar"}
              />
              <Button
                color="black"
                style={{
                  padding: 2
                }}
              >
                <Image height={30} src="/logo-white.png" />
              </Button>
            </Menu.Item>
          </Menu.Menu>

          <Menu.Menu position="right">
            <Menu.Item>
              <Input
                size="large"
                onFocus={() => {
                  this.setState({ searchBarFocused: true });
                }}
                onBlur={() => {
                  _.debounce(() => {
                    this.setState({ searchBarFocused: false });
                  }, 200)();
                  //this.setState({searchBarFocused:false})
                  //console.log('searchbar unfocused', this.state.searchBarFocused)
                }}
                onChange={this.handleChange}
                action={{
                  icon: "search",
                  color: "blue",
                  loading: this.props.searchingPhotos,
                  onClick: this.handleSearch
                }}
                placeholder={this.state.exampleSearchTerm}
              />
            </Menu.Item>
            <Menu.Item>
              <Popup
                size="mini"
                trigger={
                  <Icon
                    style={{ paddingRight: 10 }}
                    name="circle"
                    color={!this.props.workerAvailability ? "red" : "green"}
                  />
                }
                inverted
                position="bottom center"
                content={
                  this.props.workerAvailability
                    ? "Worker available!"
                    : !this.props.workerAvailability &&
                      this.props.workerRunningJob
                      ? 'Running "' +
                        this.props.workerRunningJob.job_type_str +
                        '"...'
                      : "Busy..."
                }
              />

              <Dropdown
                size="big"
                button
                icon="user"
                labeled
                text={this.props.auth.access.name}
                floating
                className="icon"
              >
                <Dropdown.Menu>
                  <Dropdown.Header>
                    Logged in as <b>{this.props.auth.access.name}</b>
                  </Dropdown.Header>
                  <Dropdown.Item onClick={() => this.props.dispatch(logout())}>
                    <Icon name="sign out" />
                    <b>Logout</b>
                  </Dropdown.Item>
                  <Dropdown.Item
                    onClick={() => this.props.dispatch(push("/settings"))}
                  >
                    <Icon name="settings" />
                    <b>Settings</b>
                  </Dropdown.Item>
                  {this.props.auth.access.is_admin && <Dropdown.Divider />}

                  {this.props.auth.access.is_admin && (
                    <Dropdown.Item
                      onClick={() => this.props.dispatch(push("/admin"))}
                    >
                      <Icon name="wrench" />
                      <b>Admin Area</b>
                    </Dropdown.Item>
                  )}
                </Dropdown.Menu>
              </Dropdown>
            </Menu.Item>
          </Menu.Menu>
        </Menu>
        {this.state.searchBarFocused && (
          <div
            style={{
              paddingTop: 5,
              paddingLeft: 10,
              paddingRight: 10,
              width: searchBarWidth,
              textAlign: "left",
              zIndex: 120,
              top: topMenuHeight,
              left: (this.state.width - searchBarWidth) / 2,
              position: "absolute"
            }}
          >
            <Header as="h3" attached="top">
              Search Suggestions
            </Header>
            {filteredExampleSearchTerms.length > 0 && (
              <Segment
                attached
                raised
                textAlign="left"
                style={{ paddingTop: 0, paddingRight: 0, paddingBottom: 0 }}
              >
                <div
                  style={{
                    maxHeight: window.innerHeight / 8,
                    overflowY: "auto"
                  }}
                >
                  <div style={{ height: 10 }} />
                  {filteredExampleSearchTerms.slice(0, 10).map(el => {
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
              <Header as="h4" attached>
                My Albums
              </Header>
            )}
            {filteredSuggestedUserAlbums.length > 0 && (
              <Segment
                attached
                raised
                textAlign="left"
                style={{ paddingTop: 0, paddingRight: 0, paddingBottom: 0 }}
              >
                <div
                  style={{
                    maxHeight: window.innerHeight / 8,
                    overflowY: "auto"
                  }}
                >
                  <div style={{ height: 10 }} />
                  {filteredSuggestedUserAlbums.slice(0, 10).map(album => {
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
              <Header as="h4" attached>
                Places
              </Header>
            )}
            {filteredSuggestedPlaces.length > 0 && (
              <Segment
                attached
                raised
                textAlign="left"
                style={{ paddingTop: 0, paddingRight: 0, paddingBottom: 0 }}
              >
                <div
                  style={{
                    maxHeight: window.innerHeight / 8,
                    overflowY: "auto"
                  }}
                >
                  <div style={{ height: 10 }} />
                  {filteredSuggestedPlaces.slice(0, 10).map(place => {
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
              <Header as="h4" attached>
                Things
              </Header>
            )}
            {filteredSuggestedThings.length > 0 && (
              <Segment
                attached
                raised
                textAlign="left"
                style={{ paddingTop: 0, paddingRight: 0, paddingBottom: 0 }}
              >
                <div
                  style={{
                    maxHeight: window.innerHeight / 8,
                    overflowY: "auto"
                  }}
                >
                  <div style={{ height: 10 }} />
                  {filteredSuggestedThings.slice(0, 10).map(thing => {
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
              <Header as="h4" attached>
                People
              </Header>
            )}
            {filteredSuggestedPeople.length > 0 && (
              <Segment attached raised style={{ padding: 0 }}>
                <div
                  style={{
                    maxWidth: searchBarWidth - 5,
                    height: 60,
                    padding: 5,
                    overflow: "hidden"
                  }}
                >
                  <Image.Group>
                    {filteredSuggestedPeople.map(person => {
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
                                  fetchPeopleAlbums(person.key)
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

            <Header as="h4" attached>
              <Header.Content as={Link} to="/favorites">
                <Icon name="star" color="yellow" /> Favorites
              </Header.Content>
            </Header>
            <Header as="h4" attached="bottom">
              <Header.Content as={Link} to="/hidden">
                <Icon name="hide" color="red" /> Hidden
              </Header.Content>
            </Header>
          </div>
        )}
      </div>
    );
  }
}

export class SideMenuNarrowPublic extends Component {
  render() {
    return (
      <Menu
        borderless
        icon="labeled"
        vertical
        fixed="left"
        floated
        pointing
        width="thin"
      >
        <Divider hidden />
        <Divider hidden />
        <Divider hidden />
        <Divider hidden />

        <Dropdown
          pointing="left"
          item
          icon={
            <Icon.Group size="big">
              <Icon name="globe" />
            </Icon.Group>
          }
        >
          <Dropdown.Menu>
            <Dropdown.Header>Public</Dropdown.Header>
            <Dropdown.Item as={Link} to="/users/">
              <Icon name="users" />
              {"  Users"}
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown>
        <div style={{ marginTop: -17 }}>
          <small>Public</small>
        </div>
      </Menu>
    );
  }
}

export class SideMenuNarrow extends Component {
  state = { activeItem: "all photos" };

  handleItemClick = (e, { name }) => this.setState({ activeItem: name });
  handleLogout = (e, { name }) => this.props.dispatch(logout());

  render() {
    var authMenu = (
      <Menu.Item onClick={this.handleLogout} name="loginout">
        <Popup
          inverted
          size="mini"
          position="right center"
          content="Sign out"
          trigger={<Icon name="sign out" corner />}
        />
      </Menu.Item>
    );

    const { activeItem } = this.state;
    return (
      <Menu
        borderless
        icon="labeled"
        vertical
        fixed="left"
        floated
        pointing
        width="thin"
      >
        <Divider hidden />
        <Divider hidden />
        <Divider hidden />
        <Divider hidden />

        {false && (
          <Menu.Item name="logo">
            <img height={40} src="/logo.png" />
            <p>
              <small>Ownphotos</small>
            </p>
          </Menu.Item>
        )}

        <Dropdown
          pointing="left"
          item
          icon={
            <Icon.Group size="big">
              <Icon name="image outline" />
            </Icon.Group>
          }
        >
          <Dropdown.Menu>
            <Dropdown.Header>Photos</Dropdown.Header>
            <Dropdown.Item as={Link} to="/">
              <Icon color="green" name="calendar check outline" />
              {"  With Timestamp"}
            </Dropdown.Item>
            <Dropdown.Item as={Link} to="/notimestamp">
              <Icon color="red" name="calendar times outline" />
              {"  Without Timestamp"}
            </Dropdown.Item>
            <Dropdown.Divider />

            <Dropdown.Item as={Link} to="/recent">
              <Icon name="clock" />
              {"  Recently Added"}
            </Dropdown.Item>
            <Dropdown.Divider />

            <Dropdown.Item as={Link} to="/hidden">
              <Icon color="red" name="hide" />
              {"  Hidden"}
            </Dropdown.Item>
            <Dropdown.Item as={Link} to="/favorites">
              <Icon name="star" color="yellow" />
              {"  Favorites"}
            </Dropdown.Item>
            <Dropdown.Item
                  disabled={!this.props.auth.access}
                  as={Link}
                  to={
                    this.props.auth.access
                      ? `/user/${this.props.auth.access.name}`
                      : "/"
                  }
                >
                  <Icon color='green' name="globe" />
                  {"  My Public Photos"}
                </Dropdown.Item>

          </Dropdown.Menu>
        </Dropdown>
        <div style={{ marginTop: -17 }}>
          <small>Photos</small>
        </div>

        <Divider hidden />

        <Dropdown
          pointing="left"
          item
          icon={
            <Icon.Group size="big">
              <Icon name="images outline" />
              <Icon name="bookmark" corner />
            </Icon.Group>
          }
        >
          <Dropdown.Menu>
            <Dropdown.Header>Albums</Dropdown.Header>
            <Dropdown.Item as={Link} to="/people">
              <Icon name="users" />
              {"  People"}
            </Dropdown.Item>
            <Dropdown.Item as={Link} to="/places">
              <Icon name="map" />
              {"  Places"}
            </Dropdown.Item>
            <Dropdown.Item as={Link} to="/things">
              <Icon name="tags" />
              {"  Things"}
            </Dropdown.Item>
            <Dropdown.Divider />
            <Dropdown.Item as={Link} to="/useralbums">
              <Icon name="bookmark" />
              {"  My Albums"}
            </Dropdown.Item>
            <Dropdown.Item as={Link} to="/events">
              <Icon name="wizard" />
              {"  Auto Created Albums"}
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown>
        <div style={{ marginTop: -17 }}>
          <small>Albums</small>
        </div>

        <Divider hidden />
        <Dropdown
          pointing="left"
          item
          icon={
            <Icon.Group size="big">
              <Icon name="bar chart" />
            </Icon.Group>
          }
        >
          <Dropdown.Menu>
            <Dropdown.Header>Data Visualization</Dropdown.Header>
            <Dropdown.Item as={Link} to="/placetree">
              <Icon name="sitemap" />
              {"  Place Tree"}
            </Dropdown.Item>

            <Dropdown.Item as={Link} to="/wordclouds">
              <Icon name="cloud" />
              {"  Word Clouds"}
            </Dropdown.Item>

            <Dropdown.Item as={Link} to="/timeline">
              <Icon name="bar chart" />
              {"  Timeline"}
            </Dropdown.Item>

            <Dropdown.Item as={Link} to="/socialgraph">
              <Icon name="share alternate" />
              {"  Social Graph"}
            </Dropdown.Item>

            <Dropdown.Item as={Link} to="/facescatter">
              <Icon name="users circle" />
              {"  Face Clusters"}
            </Dropdown.Item>

          </Dropdown.Menu>
        </Dropdown>
        <div style={{ marginTop: -17 }}>
          <small>Data Viz</small>
        </div>

        <Divider hidden />
        <Dropdown
          pointing="left"
          item
          icon={
            <Icon.Group size="big">
              <Icon name="dashboard" />
            </Icon.Group>
          }
        >
          <Dropdown.Menu>
            <Dropdown.Header>Dashboards</Dropdown.Header>
            <Dropdown.Item as={Link} to="/faces">
              <Icon name="user circle outline" />
              {"  Face Recognition"}
            </Dropdown.Item>
            <Dropdown.Item as={Link} to="/settings">
              <Icon name="database" />
              {"  Library"}
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown>
        <div style={{ marginTop: -17 }}>
          <small>Dashboards</small>
        </div>

        {this.props.auth && (
          <div>
            <Divider hidden />
            <Dropdown
              pointing="left"
              item
              icon={
                <Icon.Group size="big">
                  <Icon name="users" />
                </Icon.Group>
              }
            >
              <Dropdown.Menu>
                <Dropdown.Header>Sharing</Dropdown.Header>

                <Dropdown.Item
                  disabled={!this.props.auth.access}
                  as={Link}
                  to={`/users/`}
                >
                  <Icon name="globe" />
                  {"  Public photos"}
                </Dropdown.Item>


                <Dropdown.Item as={Link} to="/shared/fromme/photos/">
                  <Icon name="share" color='red'/>
                  {"  You shared"}
                </Dropdown.Item>

                <Dropdown.Item as={Link} to="/shared/tome/photos/">
                  <Icon name="share" color='green'/>
                  {"  Shared with you"}
                </Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown>
            <div style={{ marginTop: -17 }}>
              <small>Sharing</small>
            </div>
          </div>
        )}
      </Menu>
    );
  }
}

export class SideMenu extends Component {
  state = { activeItem: "photos" };

  handleItemClick = (e, { name }) => this.setState({ activeItem: name });
  handleLogout = (e, { name }) => this.props.dispatch(logout());

  render() {
    if (this.props.jwtToken == null) {
      var authMenu = (
        <Menu.Item name="loginout" as={Link} to="/login">
          <Icon name="sign out" corner /> Log In
        </Menu.Item>
      );
    } else {
      var authMenu = (
        <Menu.Item
          onClick={this.handleLogout}
          name="loginout"
          as={Link}
          to="/login"
        >
          <Icon name="sign in" corner /> Log Out
        </Menu.Item>
      );
    }

    const { activeItem } = this.state;
    return (
      <Sidebar
        as={Menu}
        vertical
        fixed="left"
        width="thin"
        color="black"
        animation="overlay"
        floated
        pointing
        borderless
        inverted
      >
        <Menu.Item name="logo">
          <img src="/logo-white.png" />
        </Menu.Item>

        {authMenu}

        <Menu.Item
          onClick={this.handleItemClick}
          active={activeItem === "all photos"}
          name="all photos"
          as={Link}
          to="/"
        >
          <Icon name="image" corner />Browse
        </Menu.Item>

        <Menu.Item
          onClick={this.handleItemClick}
          active={activeItem === "search"}
          name="search"
          as={Link}
          to="/search"
        >
          <Icon name="search" corner />Search
        </Menu.Item>

        <Menu.Item>
          <Menu.Header>
            <Icon name="heart" />Favorites
          </Menu.Header>
          <Menu.Menu>
            <Menu.Item
              onClick={this.handleItemClick}
              active={activeItem === "favorites auto albums"}
              name="favorites auto albums"
              content="Events"
              as={Link}
              to="/favorite/auto"
            />
          </Menu.Menu>
        </Menu.Item>

        <Menu.Item>
          <Menu.Header>
            <Icon name="image" />Albums
          </Menu.Header>
          <Menu.Menu>
            <Menu.Item
              onClick={this.handleItemClick}
              active={activeItem === "people albums"}
              content="People"
              name="people albums"
              as={Link}
              to="/albums/people"
            />
            <Menu.Item
              onClick={this.handleItemClick}
              active={activeItem === "auto albums"}
              content="Events"
              name="auto albums"
              as={Link}
              to="/albums/auto"
            />
            <Menu.Item
              onClick={this.handleItemClick}
              active={activeItem === "date albums"}
              content="Days"
              name="date albums"
              as={Link}
              to="/albums/date"
            />
          </Menu.Menu>
        </Menu.Item>

        <Menu.Item>
          <Menu.Header>
            <Icon name="dashboard" />Dashboards
          </Menu.Header>
          <Menu.Menu>
            <Menu.Item
              onClick={this.handleItemClick}
              active={activeItem === "faces dashboard"}
              name="faces dashboard"
              content="Faces"
              as={Link}
              to="/faces"
            />
            <Menu.Item
              onClick={this.handleItemClick}
              active={activeItem === "people dashboard"}
              name="people dashboard"
              content="People"
              as={Link}
              to="/people"
            />

            <Menu.Item
              onClick={this.handleItemClick}
              active={activeItem === "statistics"}
              name="statistics"
              content="Statistics"
              as={Link}
              to="/statistics"
            />
          </Menu.Menu>
        </Menu.Item>
      </Sidebar>
    );
  }
}

SideMenu = connect(store => {
  return {
    jwtToken: store.auth.jwtToken
  };
})(SideMenu);

TopMenu = connect(store => {
  return {
    showSidebar: store.ui.showSidebar,
    gridType: store.ui.gridType,

    workerAvailability: store.util.workerAvailability,
    workerRunningJob: store.util.workerRunningJob,

    auth: store.auth,
    jwtToken: store.auth.jwtToken,
    exampleSearchTerms: store.util.exampleSearchTerms,
    fetchingExampleSearchTerms: store.util.fetchingExampleSearchTerms,
    fetchedExampleSearchTerms: store.util.fetchedExampleSearchTerms,
    searchError: store.search.error,
    searchingPhotos: store.search.searchingPhotos,
    searchedPhotos: store.search.searchedPhotos,
    people: store.people.people,
    fetchingPeople: store.people.fetchingPeople,
    fetchedPeople: store.people.fetchedPeople,

    albumsThingList: store.albums.albumsThingList,
    fetchingAlbumsThingList: store.albums.fetchingAlbumsThingList,
    fetchedAlbumsThingList: store.albums.fetchedAlbumsThingList,

    albumsUserList: store.albums.albumsUserList,
    fetchingAlbumsUserList: store.albums.fetchingAlbumsUserList,
    fetchedAlbumsUserList: store.albums.fetchedAlbumsUserList,

    albumsPlaceList: store.albums.albumsPlaceList,
    fetchingAlbumsPlaceList: store.albums.fetchingAlbumsPlaceList,
    fetchedAlbumsPlaceList: store.albums.fetchedAlbumsPlaceList
  };
})(TopMenu);

TopMenuPublic = connect(store => {
  return {
    showSidebar: store.ui.showSidebar,
    gridType: store.ui.gridType
  };
})(TopMenuPublic);

SideMenuNarrow = connect(store => {
  return {
    auth: store.auth,
    jwtToken: store.auth.jwtToken,
    location: store.routerReducer.location
  };
})(SideMenuNarrow);
