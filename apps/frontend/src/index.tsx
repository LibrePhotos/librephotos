import "font-awesome/css/font-awesome.min.css";
import React from "react";
// css
import { CookiesProvider } from "react-cookie";
import ReactDOM from "react-dom";
import "react-leaflet-markercluster/dist/styles.min.css";
import { Provider } from "react-redux";
import "react-vis/dist/style.css";
import "semantic-ui-css/semantic.min.css";

import App from "./App";
import { store } from "./store/store";

ReactDOM.render(
  <Provider store={store}>
    <CookiesProvider>
      <App />
    </CookiesProvider>
  </Provider>,

  document.getElementById("root")
);
