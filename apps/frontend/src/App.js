import React, { Component } from 'react';
import logo from './logo.svg';
import './App.css';

import {FacesDashboard} from './layouts/facesDashboard'
import {PeopleDashboard} from './layouts/peopleDashboard'

class App extends Component {
  render() {
    return (
      <div>
        <PeopleDashboard/>
        <FacesDashboard/>
      </div>
    );
  }
}

export default App;
