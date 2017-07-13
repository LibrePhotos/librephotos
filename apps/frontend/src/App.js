import React, { Component } from 'react';
import logo from './logo.svg';
import './App.css';
import {FaceCards, FaceToLabel} from './components/FaceCards';
import {GridExampleColumnWidth} from './layouts/gridTest'

class App extends Component {
  render() {
    return (
      <div>
        <GridExampleColumnWidth/>
      </div>
    );
  }
}

export default App;
