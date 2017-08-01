import React from 'react';
import ReactDOM from 'react-dom';
import 'semantic-ui-css/semantic.min.css';
import 'react-vis/dist/style.css'
import App from './App';
import BasicExample from './routerExample'
import registerServiceWorker from './registerServiceWorker';
import store from "./store"
import { Provider } from "react-redux"

import {LoginPage} from './layouts/loginPage'
import {CountryPiChart} from './components/charts/countryPiChart'



ReactDOM.render(
<Provider store={store}>
	<App/>
</Provider>
, document.getElementById('root'));
registerServiceWorker();
