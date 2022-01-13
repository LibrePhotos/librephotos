import React, { Component } from "react";
import { connect } from "react-redux";
import { Route, Switch } from "react-router-dom";
import NotificationSystem from "reapop";
import theme from "reapop-theme-wybo";
import "./App.css";
import { CountStats } from "./components/statistics";
import Login from "./containers/login";
import {
  FaceScatter,
  Graph,
  LocationTree,
  PhotoMap,
  Timeline,
  WordClouds,
} from "./layouts/dataviz/DataVisualization";
import { FaceDashboard } from "./layouts/dataviz/FaceDashboard";
import { FavoritePhotos } from "./layouts/photos/FavoritePhotos";
import { HiddenPhotos } from "./layouts/photos/HiddenPhotos";
import { SignupPage } from "./layouts/login/SignUpPage";
import { AlbumAutoGalleryView } from "./layouts/albums/AlbumAutoGalleryView";
import { AlbumAuto } from "./layouts/albums/AlbumAuto";
import { AlbumPeople } from "./layouts/albums/AlbumPeople";
import { AlbumPersonGallery } from "./layouts/albums/AlbumPersonGallery";
import { AlbumPlaceGallery } from "./layouts/albums/AlbumPlaceGallery";
import { AlbumThingGallery } from "./layouts/albums/AlbumThingGallery";
import { AlbumThing } from "./layouts/albums/AlbumThing";
import { AlbumUser } from "./layouts/albums/AlbumUser";
import { AlbumUserGallery } from "./layouts/albums/AlbumUserGallery";
import { SideMenuNarrow } from "./components/menubars/SideMenuNarrow";
import { TopMenu } from "./components/menubars/TopMenu";
import { NoTimestampPhotosView } from "./layouts/photos/NoTimestampPhotosView";
import { RecentlyAddedPhotos } from "./layouts/photos/RecentlyAddedPhotos";
import PrivateRoute from "./layouts/PrivateRoute";
import { SearchView } from "./layouts/SearchView";
import { Settings } from "./layouts/settings/Settings";
import { AdminPage } from "./layouts/settings/AdminPage";
import { Statistics } from "./layouts/dataviz/Statistics";
import { UserPublicPage } from "./layouts/public/UserPublicPage";
import { PublicUserList } from "./layouts/public/PublicUserList";
import { SharedToMe } from "./layouts/sharing/SharedToMe";
import { SharedFromMe } from "./layouts/sharing/SharedFromMe";
import "semantic-ui-css/semantic.min.css";
import { AlbumPlace } from "./layouts/albums/AlbumPlace";
import { TimestampPhotos } from "./layouts/photos/TimestampPhotos";

import appHistory from "./history";
import "./i18n";
import { ConnectedRouter } from "connected-react-router";
class Nav extends React.Component {
  render() {
    return (
      <div>
        {this.props.showSidebar && <SideMenuNarrow visible={true} />}
        <TopMenu style={{ zIndex: -1 }} />
      </div>
    );
  }
}

const noMenubarPaths = ["/signup", "/login"];

class App extends Component {
  render() {
    return (
      <div>
        <ConnectedRouter history={appHistory}>
          <NotificationSystem theme={theme} />
          {this.props.location.pathname &&
          !noMenubarPaths.includes(this.props.location.pathname) &&
          !(
            this.props.location.pathname.startsWith("/public") ||
            this.props.location.pathname.startsWith("/user/") ||
            this.props.location.pathname.startsWith("/users/")
          ) ? (
            <Nav showSidebar={this.props.showSidebar} />
          ) : (
            <div />
          )}

          <Switch>
            <PrivateRoute path="/" component={TimestampPhotos} exact />

            <Route path="/login" component={Login} />

            <Route path="/signup" component={SignupPage} />

            <Route
              path="/public/:username"
              component={(props) => <UserPublicPage {...props} />}
            />

            <Route path="/users" component={PublicUserList} />

            <Route
              path="/user/:username"
              component={(props) => <UserPublicPage {...props} />}
            />

            <PrivateRoute path="/things" component={AlbumThing} />

            <PrivateRoute path="/recent" component={RecentlyAddedPhotos} />

            <PrivateRoute path="/favorites" component={FavoritePhotos} />

            <PrivateRoute path="/hidden" component={HiddenPhotos} />

            <PrivateRoute
              path="/notimestamp"
              component={NoTimestampPhotosView}
            />

            <PrivateRoute path="/useralbums" component={AlbumUser} />

            <PrivateRoute path="/places" component={AlbumPlace} />

            <PrivateRoute path="/people" component={AlbumPeople} />

            <PrivateRoute path="/events" component={AlbumAuto} />

            <PrivateRoute path="/statistics" component={Statistics} />

            <PrivateRoute path="/settings" component={Settings} />

            <PrivateRoute path="/faces" component={FaceDashboard} />

            <PrivateRoute path="/search" component={SearchView} />

            <PrivateRoute
              path="/person/:albumID"
              component={AlbumPersonGallery}
            />

            <PrivateRoute
              path="/place/:albumID"
              component={AlbumPlaceGallery}
            />

            <PrivateRoute
              path="/thing/:albumID"
              component={AlbumThingGallery}
            />

            <PrivateRoute
              path="/event/:albumID"
              component={AlbumAutoGalleryView}
            />

            <PrivateRoute
              path="/useralbum/:albumID"
              component={AlbumUserGallery}
            />

            <PrivateRoute path="/shared/tome/:which" component={SharedToMe} />
            <PrivateRoute
              path="/shared/fromme/:which"
              component={SharedFromMe}
            />

            <PrivateRoute path="/admin" component={AdminPage} />

            <PrivateRoute path="/map" component={PhotoMap} />
            <PrivateRoute path="/placetree" component={LocationTree} />
            <PrivateRoute path="/wordclouds" component={WordClouds} />
            <PrivateRoute path="/timeline" component={Timeline} />
            <PrivateRoute path="/socialgraph" component={Graph} />
            <PrivateRoute path="/facescatter" component={FaceScatter} />
            <PrivateRoute path="/countstats" component={CountStats} />
          </Switch>
        </ConnectedRouter>
      </div>
    );
  }
}

App = connect((store) => {
  return {
    showSidebar: store.ui.showSidebar,
    location: store.router.location,
  };
})(App);

export default App;
