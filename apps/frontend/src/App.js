import React, { Component } from 'react';
import logo from './logo.svg';
import './App.css';
import {FaceCards} from './components/FaceCard';

class App extends Component {
  render() {
    return (
      <div>
        <FaceCards/>
      </div>
    );
  }
}

export default App;
