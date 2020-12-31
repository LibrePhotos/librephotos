import React, {Component} from 'react';
import {connect} from 'react-redux';
import {Route, Switch} from 'react-router-dom';
import {ConnectedRouter} from 'react-router-redux';
import NotificationSystem from 'reapop';
import theme from 'reapop-theme-wybo';
import './App.css';
import {CountStats} from './components/statistics';
import Login from './containers/login';
import history from './history';
import {
  FaceScatter,
  Graph,
  LocationTree,
  PhotoMap,
  Timeline,
  WordClouds,
} from './layouts/DataVisualization';
import {FaceDashboard} from './layouts/FaceDashboardV3';
import {FavoritePhotos} from './layouts/FavoritePhotos';
import {HiddenPhotos} from './layouts/HiddenPhotos';
import {SignupPage} from './layouts/SignUpPage';
import {AlbumAutoGalleryView} from './layouts/albumAutoGalleryView';
import {AlbumAuto} from './layouts/albumAuto';
import {AlbumPeople} from './layouts/albumPeople';
import {AlbumPersonGallery} from './layouts/albumPersonGallery';
import {AlbumPlaceGallery} from './layouts/albumPlaceGallery';
import {AlbumThing} from './layouts/albumThing';
import {AlbumUser} from './layouts/albumUser';
import {AlbumUserGallery} from './layouts/albumUserGallery';
import {AllPhotosHashListViewRV} from './layouts/allPhotosViewHashRV';
import {SideMenuNarrow, TopMenu} from './layouts/menubars';
import {NoTimestampPhotosView} from './layouts/noTimestampPhotosView';
import {RecentlyAddedPhotos} from './layouts/RecentlyAddedPhotos';
import PrivateRoute from './layouts/privateRoute';
import {SearchView} from './layouts/searchRV';
import {Settings} from './layouts/settings';
import {AdminPage} from './layouts/AdminPage';
import {Statistics} from './layouts/statistics';
import {SecuredImage} from './layouts/Bench';
import {UserPublicPage} from './layouts/UserPublicPage';
import {PublicUserList} from './layouts/PublicUserList';
import {LocationClusterMap} from './components/maps';
import {SharedToMe} from './layouts/SharedToMe';
import {SharedFromMe} from './layouts/SharedFromMe';


class Nav extends React.Component {
  render() {
    return (
      <div>
        {this.props.showSidebar && <SideMenuNarrow visible={true} />}
        <TopMenu style={{zIndex: -1}} />
      </div>
    );
  }
}

const noMenubarPaths = ['/signup', '/login'];

class App extends Component {

  render() {
    const menuSpacing = 0;
    return (
      <ConnectedRouter history={history}>
        <div>
          <NotificationSystem theme={theme} />
          {this.props.location &&
          !noMenubarPaths.includes(this.props.location.pathname) &&
          !(
            this.props.location.pathname.startsWith('/public') ||
            this.props.location.pathname.startsWith('/user/') ||
            this.props.location.pathname.startsWith('/users/')
          ) ? (
            <Nav showSidebar={this.props.showSidebar} />
          ) : (
            <div />
          )}

          <Switch>
            <PrivateRoute exact path="/" component={AllPhotosHashListViewRV} />

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

            <PrivateRoute path="/bench" component={SecuredImage} />

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

App = connect(store => {
  return {
    showSidebar: store.ui.showSidebar,
    location: store.routerReducer.location,
  };
})(App);

export default App;
