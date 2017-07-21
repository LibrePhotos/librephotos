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

import {MainPage} from './layouts/mainPage'
import {FacesDashboard} from './layouts/facesDashboard'
import {PeopleDashboard} from './layouts/peopleDashboard'
import {AlbumAuto} from './layouts/albumAuto'
import {AlbumPeople} from './layouts/albumPeople'


import {AlbumsAutoListCardView} from './layouts/albumsAutoListCardView'
import {AlbumAutoGalleryView} from './layouts/albumAutoGalleryView'
import {AlbumAutoMonths} from './layouts/albumAutoMonths'

class App extends Component {
  state = { activeItem: 'home' }

  handleItemClick = (e, { name }) => this.setState({ activeItem: name })

  render() {
    const { activeItem } = this.state
    return (
      <Router>
        <div>
          <Menu 
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
              active={activeItem==='home'}
              name='home'
              content="Ownphotos"
              as={Link}
              to='/'/>

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

          </Menu>
            <div style={{
              padding:'10px',
              paddingLeft:'200px'
            }}>
              <Route exact path="/" component={MainPage}/>
              <Route path="/faces" component={FacesDashboard}/>
              <Route path="/people" component={PeopleDashboard}/>
              <Route path="/albums/people" component={AlbumPeople}/>
              <Route path="/albums/auto" component={AlbumAutoMonths}/>
              <Route path='/albums/peopleview/:albumID' component={AlbumPeopleGallery}/>
              <Route path='/albums/autoview/:albumID' component={AlbumAutoGalleryView}/>

            </div>
        </div>
      </Router>
    );
  }
}

export default App;
