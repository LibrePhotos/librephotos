import React, { Component } from 'react';
import logo from './logo.svg';
import './App.css';
import {
  BrowserRouter as Router,
  Route,
  Redirect
} from 'react-router-dom'


import {Container, Menu, Grid, Button, Icon, Header} from 'semantic-ui-react'

import {Sidebar} from './layouts/sidebar'

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

class App extends Component {


  render() {

    return (
      <Router>
        <div>
            <Sidebar />
            <div style={{
              paddingTop:'20px',
              paddingRight:'20px',
              paddingLeft:'200px'
            }}>
              <Route exact path="/" component={AllPhotosView}/>

              <Route path='/niy' component={NotImplementedPlaceholder}/>

              <Route path="/login" component={LoginPage}/>

              <Route path="/favorite/auto" component={FavoriteAutoAlbumsView}/>

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
      </Router>
    );
  }
}

function requireAuth(nextState, replace) {
  console.log('hey!')
}

export default App;
