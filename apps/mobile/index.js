/**
 * @format
 */

import { decode, encode } from 'base-64'

if (!global.atob) global.atob = decode
if (!global.btoa) global.btoa = encode

import { AppRegistry } from 'react-native'
import App from './src/App'
import { name as appName } from './app.json'

AppRegistry.registerComponent(appName, () => App)
