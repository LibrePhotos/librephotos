import React, { Component } from 'react';
import logo from './logo.svg';
import './App.css';
import {
  BrowserRouter as Router,
  Route,
  Link
} from 'react-router-dom'
import {Container, Menu, Grid, Sidebar, Button, Icon, Header} from 'semantic-ui-react'

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

class App extends Component {
  state = { activeItem: 'photos' }

  handleItemClick = (e, { name }) => this.setState({ activeItem: name })

  render() {
    const { activeItem } = this.state

    return (
      <Router>
        <div>
          <Menu 
            color='black'
            pointing
            inverted
            stackable 
            size="small"
            vertical
            fixed='left'>


            <Menu.Item name='logo'>
              <img src='/logo-white.png'/>
            </Menu.Item>

            <Menu.Item 
              onClick={this.handleItemClick}
              active={activeItem==='all photos'}
              name='all photos'
              as={Link}
              to='/'>
              <Icon name='image' corner />Browse
            </Menu.Item>


            <Menu.Item 
              onClick={this.handleItemClick}
              active={activeItem==='search'}
              name='search'
              as={Link}
              to='/'>
              <Icon name='search' corner />Search
            </Menu.Item>


            <Menu.Item>
              <Menu.Header><Icon name='heart'/>Favorites</Menu.Header>
              <Menu.Menu>     
              <Menu.Item
                onClick={this.handleItemClick}
                active={activeItem==='favorites auto albums'}
                name='favorites auto albums'
                content="Events"
                as={Link}
                to='/favorite/auto'/>
              </Menu.Menu>
            </Menu.Item>


            <Menu.Item>
              <Menu.Header><Icon name='image'/>Albums</Menu.Header>
              <Menu.Menu>
                <Menu.Item
                  onClick={this.handleItemClick}
                  active={activeItem==='people albums'}
                  content='People'
                  name='people albums'
                  as={Link}
                  to='/albums/people'/>
                <Menu.Item
                  onClick={this.handleItemClick}
                  active={activeItem==='auto albums'}
                  content="Events"
                  name='auto albums'
                  as={Link}
                  to='/albums/auto'/>
              </Menu.Menu>
            </Menu.Item>

            <Menu.Item>
              <Menu.Header><Icon name='dashboard'/>Dashboards</Menu.Header>
              <Menu.Menu>            
              <Menu.Item
                onClick={this.handleItemClick}
                active={activeItem==='faces dashboard'}
                name='faces dashboard'
                content='Faces'
                as={Link}
                to='/faces'/>
              <Menu.Item
                onClick={this.handleItemClick}
                active={activeItem==='people dashboard'}
                name='people dashboard'
                content='People'
                as={Link}
                to='/people'/>

              <Menu.Item
                onClick={this.handleItemClick}
                active={activeItem==='statistics'}
                name='statistics'
                content="Statistics"
                as={Link}
                to='/statistics'/>
              </Menu.Menu>
            </Menu.Item>


          </Menu>
            <div style={{
              paddingLeft:'200px'
            }}>
              <Route exact path="/" component={PhotosListCardView}/>


              <Route path="/favorite/auto" component={FavoriteAutoAlbumsView}/>


              <Route path="/faces" component={FacesDashboard}/>
              <Route path="/people" component={PeopleDashboard}/>
              <Route path="/statistics" component={Statistics}/>


              <Route path="/albums/people" component={AlbumPeople}/>
              <Route path="/albums/auto" component={AlbumAutoMonths}/>

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

export default App;
