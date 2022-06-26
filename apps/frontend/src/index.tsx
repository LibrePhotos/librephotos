import "./wdyr";

import "font-awesome/css/font-awesome.min.css";
import React from "react";
// css
import ReactDOM from "react-dom";
import "react-leaflet-markercluster/dist/styles.min.css";
import { Provider } from "react-redux";
import { Router } from "react-router-dom";
import "react-vis/dist/style.css";
import "semantic-ui-css/semantic.min.css";

import App from "./App";
import { libreHistory, store } from "./store/store";

ReactDOM.render(
  <Provider store={store}>
    <Router history={libreHistory}>
      <App />
    </Router>
  </Provider>,
  document.getElementById("root")
);
