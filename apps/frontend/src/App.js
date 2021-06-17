import React, { Component } from "react";
import { connect } from "react-redux";
import { Route, Switch } from "react-router-dom";
import { ConnectedRouter } from "react-router-redux";
import NotificationSystem from "reapop";
import theme from "reapop-theme-wybo";
import "./App.css";
import { CountStats } from "./components/statistics";
import Login from "./containers/login";
import history from "./history";
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
import { AlbumThing } from "./layouts/albums/AlbumThing";
import { AlbumUser } from "./layouts/albums/AlbumUser";
import { AlbumUserGallery } from "./layouts/albums/AlbumUserGallery";
import { TimelinePhotoView } from "./layouts/albums/TimelinePhotoView";
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
import { LocationClusterMap } from "./components/maps";
import { SharedToMe } from "./layouts/sharing/SharedToMe";
import { SharedFromMe } from "./layouts/sharing/SharedFromMe";

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
      <ConnectedRouter history={history}>
        <div>
          <NotificationSystem theme={theme} />
          {this.props.location &&
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
            <PrivateRoute exact path="/" component={TimelinePhotoView} />

            <Route path="/login" component={Login} />

            <Route path="/signup" component={SignupPage} />

            <Route path="/public" component={UserPublicPage} />

            <Route path="/users" component={PublicUserList} />

            <Route path="/user/:username" component={UserPublicPage} />

            <PrivateRoute path="/things" component={AlbumThing} />

            <PrivateRoute path="/recent" component={RecentlyAddedPhotos} />

            <PrivateRoute path="/favorites" component={FavoritePhotos} />

            <PrivateRoute path="/hidden" component={HiddenPhotos} />

            <PrivateRoute
              path="/notimestamp"
              component={NoTimestampPhotosView}
            />

            <PrivateRoute path="/useralbums" component={AlbumUser} />

            <PrivateRoute path="/places" component={LocationClusterMap} />

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
        </div>
      </ConnectedRouter>
    );
  }
}

App = connect((store) => {
  return {
    showSidebar: store.ui.showSidebar,
    location: store.routerReducer.location,
  };
})(App);

export default App;
