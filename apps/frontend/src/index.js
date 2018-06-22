import React from 'react';
import ReactDOM from 'react-dom';

import 'semantic-ui-css/semantic.min.css';
import 'react-vis/dist/style.css'
import 'font-awesome/css/font-awesome.min.css';
import 'react-leaflet-markercluster/dist/styles.min.css'; // css
import { CookiesProvider } from 'react-cookie'



import App from './App';
import registerServiceWorker from './registerServiceWorker';
import configureStore from "./store"
import { Provider } from "react-redux"

import {LoginPage} from './layouts/loginPage'
import {CountryPiChart} from './components/charts/countryPiChart'

import history from './history'
import store from './store'

// export const store = configureStore(history)



ReactDOM.render(
<Provider store={store}>
    <CookiesProvider>
		<App/>
    </CookiesProvider>
</Provider>
, document.getElementById('root'));

registerServiceWorker();
