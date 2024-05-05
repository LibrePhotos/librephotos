import "./wdyr";

import "@mantine/core/styles.css";
import "font-awesome/css/font-awesome.min.css";
import React from "react";
// css
import { createRoot } from "react-dom/client";
import "react-leaflet-markercluster/dist/styles.min.css";
import { Provider } from "react-redux";
import "react-vis/dist/style.css";
import { HistoryRouter as Router } from "redux-first-history/rr6";

import { App } from "./App";
import { libreHistory, store } from "./store/store";

const container = document.getElementById("root");
const root = createRoot(container!); // createRoot(container!) if you use TypeScript
root.render(
  <Provider store={store}>
    <Router history={libreHistory}>
      <App />
    </Router>
  </Provider>
);
