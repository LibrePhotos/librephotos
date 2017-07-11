import React from 'react';
import ReactDOM from 'react-dom';
import 'semantic-ui-css/semantic.min.css';
import App from './App';
import registerServiceWorker from './registerServiceWorker';
import store from "./store"
import { Provider } from "react-redux"
ReactDOM.render(
<Provider store={store}>
	<App />
</Provider>
, document.getElementById('root'));
registerServiceWorker();
