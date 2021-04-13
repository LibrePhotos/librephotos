import React from 'react';
import ReactDOM from 'react-dom';
import 'semantic-ui-css/semantic.min.css';
import 'react-vis/dist/style.css'
import 'font-awesome/css/font-awesome.min.css';
import 'react-leaflet-markercluster/dist/styles.min.css'; // css
import { CookiesProvider } from 'react-cookie'
import App from './App';
import { Provider } from "react-redux"
import store from './store'


ReactDOM.render(
<Provider store={store}>
    <CookiesProvider>
		<App/>
    </CookiesProvider>
</Provider>
, document.getElementById('root'));
