import React, { Component } from 'react';
import logo from './logo.svg';
import './App.css';
import {FacesDashboard} from './layouts/facesDashboard'
import {AlbumDates} from './components/album'
class App extends Component {
  render() {
    return (
      <div>
        <FacesDashboard/>
      </div>
    );
  }
}

export default App;
