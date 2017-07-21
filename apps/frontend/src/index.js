import React from 'react';
import ReactDOM from 'react-dom';
import 'semantic-ui-css/semantic.min.css';
import 'react-vis/dist/style.css'
import App from './App';
import BasicExample from './routerExample'
import registerServiceWorker from './registerServiceWorker';
import store from "./store"
import { Provider } from "react-redux"

import {ListExample} from './layouts/albumsAutoListCardViewMonthGroup'

ReactDOM.render(
<Provider store={store}>
	<ListExample/>
</Provider>
, document.getElementById('root'));
registerServiceWorker();
