import { buildSlice } from '@thecodingmachine/redux-toolkit-wrapper'
import AppSettings from './AppSettings'

const defaultState = {}

export default buildSlice('settings', [AppSettings], defaultState).reducer
