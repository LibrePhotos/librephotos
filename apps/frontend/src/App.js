import React, { Component } from 'react';
import logo from './logo.svg';
import './App.css';
import {
  BrowserRouter as Router,
  Route,
  Switch,
  Redirect
} from 'react-router-dom'
import { ConnectedRouter, routerReducer, routerMiddleware, push } from 'react-router-redux'


import {Container, Divider, Menu, Grid, Segment, Button, Icon, Rail, Header, Sidebar, Sticky} from 'semantic-ui-react'

import {SideMenuNarrow, TopMenu} from './layouts/menubars'

import {Albums} from './layouts/albums'

import {AlbumPeopleGallery, AlbumAutoGallery} from './components/album'

import {Statistics} from './layouts/statistics'

import {FacesDashboard} from './layouts/facesDashboard'
import {FacesDashboardV2} from './layouts/facesDashboardV2'
import {FaceDashboard} from './layouts/FaceDashboardV3'

import {PeopleDashboard} from './layouts/peopleDashboard'

import {AlbumAuto} from './layouts/albumAuto'
import {AlbumAutoRV} from './layouts/albumAutoRV'

import {AlbumPeople} from './layouts/albumPeople'
import {AlbumPersonGallery} from './layouts/albumPersonGallery'

import {AlbumsAutoListCardView} from './layouts/albumsAutoListCardView'

import {AlbumAutoGalleryView} from './layouts/albumAutoGalleryView'
import {AlbumDateGalleryView} from './layouts/albumDateGalleryView'
import {AlbumAutoMonths} from './layouts/albumAutoMonths'
import {AlbumDateMonths} from './layouts/albumDateMonths'

import {AlbumThing} from './layouts/albumThing'

import {AlbumUser} from './layouts/albumUser'
import {AlbumUserGallery} from './layouts/albumUserGallery'

import {AlbumPlace} from './layouts/albumPlace'
import {AlbumPlaceGallery} from './layouts/albumPlaceGallery'

import {AllPhotosView} from './layouts/allPhotosView'
import {AllPhotosGroupedByDate} from './layouts/allPhotosGroupedByDate'


import {FavoriteAutoAlbumsView} from './layouts/favoriteAutoAlbums'

import {NoTimestampPhotosView} from './layouts/noTimestampPhotosView'

import EventCountMonthGraph from './components/eventCountMonthGraph'

import {ListExample} from './layouts/RVListExample'

import {PhotosListCardView} from './layouts/allPhotosViewRV'
import {ChartyPhotosScrollbar} from './components/chartyPhotosScrollbar'

import {AllPhotosViewLL} from './layouts/allPhotosViewLL'
import {AllPhotosHashListView} from './layouts/allPhotosViewHash'
import {AllPhotosHashListViewRV} from './layouts/allPhotosViewHashRV'

import {LoginPage} from './layouts/loginPage'
import Login from './containers/login'

import {Settings} from './layouts/settings'

import {NotImplementedPlaceholder} from './layouts/notImplementedPlaceholder'
import {CountryPiChart} from './components/charts/countryPiChart'

// import {SearchView} from './layouts/search'
import {SearchViewRV, SearchView} from './layouts/searchRV'
import {SearchMultipleCategories} from './layouts/searchMultipleResultsCategories'
import {FavoritePhotos} from './layouts/FavoritePhotos'
import {HiddenPhotos} from './layouts/HiddenPhotos'

import {ImageInfoTable} from './components/imageInfoTable'
import history from './history'

import store from './store'
import { connect } from "react-redux";
import * as reducers from './reducers'

import PrivateRoute from './layouts/privateRoute'

import NotificationSystem from 'reapop'
import theme from 'reapop-theme-wybo';

import {AllPhotosMap, EventMap, LocationClusterMap} from './components/maps'


import {
  PhotoMap,
  LocationTree,
  WordClouds,
  Timeline,
  Graph,
  FaceScatter} from './layouts/DataVisualization'


/*
store.subscribe(listener)

var jwt = null

function select(state) {
  return state.auth.jwtToken
}

function listener() {
  let token = select(store.getState())
  jwt = token
}
*/


var topMenuHeight = 55 // don't change this
var leftMenuWidth = 85 // don't change this


class Nav extends React.Component {
  render() {
    return (
      <div>
        {this.props.showSidebar && (<SideMenuNarrow visible={true}/>)}
        <TopMenu style={{zIndex:-1}}/>
      </div>
    )
  }
}

class App extends Component {


  /*
  componentWillMount() {
    if (this.props.jwtToken == null) {
      store.dispatch(push('/login/'))
    }
  }
  */

  render() {
    const menuSpacing = 0
    console.log('app.js',this.props)
    return (

      <ConnectedRouter history={history}>
      <div>
        <NotificationSystem theme={theme}/>
        { this.props.location && this.props.location.pathname!='/login' && <Nav showSidebar={this.props.showSidebar}/> }
        <Switch>

              <PrivateRoute exact path="/" component={AllPhotosHashListViewRV}/>

              <Route path="/login" component={Login}/>

              <PrivateRoute path="/things" component={AlbumThing}/>
              
              <PrivateRoute path="/favorites" component={FavoritePhotos}/>

              <PrivateRoute path="/hidden" component={HiddenPhotos}/>

              <PrivateRoute path="/notimestamp" component={NoTimestampPhotosView}/>
              
              <PrivateRoute path="/useralbums" component={AlbumUser}/>

              <PrivateRoute path="/places" component={AlbumPlace}/>

              <PrivateRoute path="/people" component={AlbumPeople}/>

              <PrivateRoute path="/events" component={AlbumAutoRV}/>

              <PrivateRoute path="/statistics" component={Statistics}/>

              <PrivateRoute path="/settings" component={Settings}/>

              <PrivateRoute path="/faces" component={FaceDashboard}/>

              <PrivateRoute path="/search" component={SearchView}/>

              <PrivateRoute path='/person/:albumID' component={AlbumPersonGallery}/>

              <PrivateRoute path='/place/:albumID' component={AlbumPlaceGallery}/>

              <PrivateRoute path='/event/:albumID' component={AlbumAutoGalleryView}/>

              <PrivateRoute path='/useralbum/:albumID' component={AlbumUserGallery}/>

              


              <PrivateRoute path='/map' component={PhotoMap}/>
              <PrivateRoute path='/placetree' component={LocationTree}/>
              <PrivateRoute path='/wordclouds' component={WordClouds}/>
              <PrivateRoute path='/timeline' component={Timeline}/>
              <PrivateRoute path='/socialgraph' component={Graph}/>
              <PrivateRoute path='/facescatter' component={FaceScatter}/>


        </Switch>
      </div>
      </ConnectedRouter>
    );
  }
}



App = connect((store)=>{
  return {
    showSidebar: store.ui.showSidebar,
    location: store.routerReducer.location,
  }
})(App)

export default App;
/*
const mapStateToProps = (state) => ({
  router: state.routerReducer
})

const mapDispatchToProps = (dispatch) => ({
})

export default connect(mapStateToProps, null)(App)
*/
