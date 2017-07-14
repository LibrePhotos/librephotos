import React, { Component } from 'react';
import logo from './logo.svg';
import './App.css';
import {FaceCards, FaceToLabel} from './components/faces';
import {FacesDashboard} from './layouts/gridTest'

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
