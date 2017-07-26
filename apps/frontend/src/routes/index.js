import React               from 'react';  
import { Route, Redirect } from 'react-router-dom'  

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



export default function configRoutes() {  
  return (
    <div>
      <Navigation />
      <Route exact path="/" component={AllPhotosViewLL} />
      <Route path="/login" component={loginPage} />
      <AuthenticatedRoute path="/photos" component={allPhotosGroupedByDate} />
    </div>
  );
}

const AuthenticatedRoute = ({ component: Component, ...rest }) => (  
  <Route {...rest} render={props => (
    localStorage.getItem('phoenixAuthToken') ? (
      <Component {...props}/>
    ) : (
      <Redirect to={{
        pathname: '/sign_in',
        state: { from: props.location }
      }}/>
    )
  )}/>
)