import React, { Component } from 'react';
import logo from './logo.svg';
import './App.css';
import {FaceCards, FaceToLabel} from './components/FaceCards';
import {FaceLabeler} from './components/FaceLabeler'
class App extends Component {
  render() {
    return (
      <div>
        <FaceLabeler/>
      </div>
    );
  }
}

export default App;
