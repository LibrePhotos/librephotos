import React, { Component } from 'react';
import logo from './logo.svg';
import './App.css';
import {FacesDashboard} from './layouts/facesDashboard'
import {AlbumDates} from './components/album'
import {PeopleCardGroup} from './components/people'
class App extends Component {
  render() {
    return (
      <div>
        <PeopleCardGroup/>
      </div>
    );
  }
}

export default App;
