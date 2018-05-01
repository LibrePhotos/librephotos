import React, { Component } from 'react';
import logo from './logo.svg';
import './App.css';
import {
  BrowserRouter as Router,
  Route,
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

import {AlbumPlace} from './layouts/albumPlace'

import {AllPhotosView} from './layouts/allPhotosView'
import {AllPhotosGroupedByDate} from './layouts/allPhotosGroupedByDate'


import {FavoriteAutoAlbumsView} from './layouts/favoriteAutoAlbums'


import EventCountMonthGraph from './components/eventCountMonthGraph'

import {ListExample} from './layouts/RVListExample'

import {PhotosListCardView} from './layouts/allPhotosViewRV'
import {ChartyPhotosScrollbar} from './components/chartyPhotosScrollbar'

import {AllPhotosViewLL} from './layouts/allPhotosViewLL'
import {AllPhotosHashListView} from './layouts/allPhotosViewHash'
import {AllPhotosHashListViewRV} from './layouts/allPhotosViewHashRV'

import {LoginPage} from './layouts/loginPage'

import {NotImplementedPlaceholder} from './layouts/notImplementedPlaceholder'
import {CountryPiChart} from './components/charts/countryPiChart'

import {SearchView} from './layouts/search'
import {SearchViewRV} from './layouts/searchRV'

import {ImageInfoTable} from './components/imageInfoTable'
import history from './history'

var topMenuHeight = 55 // don't change this
var leftMenuWidth = 85 // don't change this

class App extends Component {

  state = { sidebarVisible: true }

  toggleVisibility = () => this.setState({ sidebarVisible: true })

  render() {
    const { sidebarVisible } = this.state
    if (this.state.sidebarVisible) {
      var menuSpacing = leftMenuWidth
    }
    else {
      var menuSpacing = 0
    }
    return (
      <ConnectedRouter history={history}>
        <div>
          <SideMenuNarrow visible={true}/>
          <TopMenu style={{zIndex:-1}}/>
          <div style={{paddingLeft:menuSpacing+5,paddingRight:0}}>

            <div style={{paddingTop:topMenuHeight}}>
            

            <Route exact path="/" component={AllPhotosHashListViewRV}/>

            <Route path='/test' component={CountryPiChart}/>


            <Route path='/niy' component={ImageInfoTable}/>

            <Route path='/search' component={SearchViewRV}/>

            <Route path="/login" component={LoginPage}/>

            <Route path="/favorite/auto" component={FavoriteAutoAlbumsView}/>

            <Route path="/things" component={AlbumThing}/>
            <Route path="/places" component={AlbumPlace}/>
            <Route path="/people" component={AlbumPeople}/>
            <Route path="/events" component={AlbumAutoRV}/>

            <Route path="/statistics" component={Statistics}/>
            <Route path="/faces" component={FacesDashboardV2}/>

            <Route path='/person/:albumID' component={AlbumPersonGallery}/>
            <Route path='/events/:albumID' component={AlbumAutoGalleryView}/>
            </div>
          </div>

        </div>
      </ConnectedRouter>
    );
  }
}

function requireAuth(nextState, replace) {
  console.log('hey!')
}

export default App;
