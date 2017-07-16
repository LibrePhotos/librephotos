import React, { Component } from 'react';
import logo from './logo.svg';
import './App.css';
import {
  BrowserRouter as Router,
  Route,
  Link
} from 'react-router-dom'
import {Container, Menu, Grid, Sidebar, Button, Icon} from 'semantic-ui-react'

import {FacesDashboard} from './layouts/facesDashboard'
import {PeopleDashboard} from './layouts/peopleDashboard'

import {AlbumPeopleCardGroup, AlbumAutoCardGroup, 
        AlbumAutoGallery, AlbumPeopleGallery} from './components/album'

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
            stackable 
            size="small"
            vertical
            inverted
            fixed='left'>
            <Menu.Item
              onClick={this.handleItemClick}
              active={activeItem==='home'}
              name='home'
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
              <Route exact path="/" component={FacesDashboard}/>
              <Route path="/faces" component={FacesDashboard}/>
              <Route path="/people" component={PeopleDashboard}/>
              <Route path="/albums/people" component={AlbumPeopleCardGroup}/>
              <Route path="/albums/auto" component={AlbumAutoCardGroup}/>
              <Route path='/albums/peopleview/:albumID' component={AlbumPeopleGallery}/>
              <Route path='/albums/autoview/:albumID' component={AlbumAutoGallery}/>

            </div>
        </div>
      </Router>
    );
  }
}

export default App;
