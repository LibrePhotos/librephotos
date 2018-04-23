import React, { Component } from 'react';
import logo from './logo.svg';
import './App.css';
import {
  BrowserRouter as Router,
  Route,
  Redirect
} from 'react-router-dom'


import {Container, Divider, Menu, Grid, Segment, Button, Icon, Rail, Header, Sidebar, Sticky} from 'semantic-ui-react'

import {SideMenuNarrow, TopMenu} from './layouts/menubars'

import {Albums} from './layouts/albums'

import {AlbumPeopleGallery, AlbumAutoGallery} from './components/album'

import {Statistics} from './layouts/statistics'
import {FacesDashboard} from './layouts/facesDashboard'
import {PeopleDashboard} from './layouts/peopleDashboard'
import {AlbumAuto} from './layouts/albumAuto'
import {AlbumPeople} from './layouts/albumPeople'

import {AlbumsAutoListCardView} from './layouts/albumsAutoListCardView'

import {AlbumAutoGalleryView} from './layouts/albumAutoGalleryView'
import {AlbumDateGalleryView} from './layouts/albumDateGalleryView'
import {AlbumAutoMonths} from './layouts/albumAutoMonths'
import {AlbumDateMonths} from './layouts/albumDateMonths'

import {AlbumThing} from './layouts/albumThing'

import {AllPhotosView} from './layouts/allPhotosView'
import {AllPhotosGroupedByDate} from './layouts/allPhotosGroupedByDate'


import {FavoriteAutoAlbumsView} from './layouts/favoriteAutoAlbums'


import EventCountMonthGraph from './components/eventCountMonthGraph'

import {ListExample} from './layouts/RVListExample'

import {PhotosListCardView} from './layouts/allPhotosViewRV'
import {ChartyPhotosScrollbar} from './components/chartyPhotosScrollbar'

import {AllPhotosViewLL} from './layouts/allPhotosViewLL'

import {LoginPage} from './layouts/loginPage'

import {NotImplementedPlaceholder} from './layouts/notImplementedPlaceholder'
import {CountryPiChart} from './components/charts/countryPiChart'

import {SearchView} from './layouts/search'

import {ImageInfoTable} from './components/imageInfoTable'

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
      <Router>
        <div>
          <SideMenuNarrow visible={true}/>
          <TopMenu style={{zIndex:-1}}/>
          <div style={{paddingLeft:menuSpacing+5,paddingRight:5}}>

            <div style={{paddingTop:topMenuHeight+15}}>
            

            <Route exact path="/" component={AllPhotosView}/>

            <Route path='/test' component={CountryPiChart}/>


            <Route path='/niy' component={ImageInfoTable}/>

            <Route path='/search' component={SearchView}/>

            <Route path="/login" component={LoginPage}/>

            <Route path="/favorite/auto" component={FavoriteAutoAlbumsView}/>

            <Route path="/things" component={AlbumThing}/>

            <Route path="/faces" component={FacesDashboard}/>
            <Route path="/people" component={PeopleDashboard}/>
            <Route path="/statistics" component={Statistics}/>

            <Route path="/albums/people" component={AlbumPeople}/>
            <Route path="/albums/auto" component={AlbumAutoMonths}/>
            <Route path="/albums/date" component={AlbumDateMonths}/>

            <Route path='/albums/peopleview/:albumID' component={AlbumPeopleGallery}/>
            <Route path='/albums/autoview/:albumID' component={AlbumAutoGalleryView}/>
            <Route path='/albums/dateview/:albumID' component={AlbumDateGalleryView}/>

            <Route path='/favorite/autoview/:albumID' component={AlbumAutoGalleryView}/>
            </div>
          </div>

        </div>
      </Router>
    );
  }
}

function requireAuth(nextState, replace) {
  console.log('hey!')
}

export default App;
