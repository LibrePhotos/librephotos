import React, { Component } from 'react';
import logo from './logo.svg';
import './App.css';
import {FaceCards, FaceToLabel} from './components/FaceCards';
import {FaceLabeler} from './components/FaceLabeler'
import {MyGrid} from './layouts/gridTest'

class App extends Component {
  render() {
    return (
      <div>
        <MyGrid/>
      </div>
    );
  }
}

export default App;
