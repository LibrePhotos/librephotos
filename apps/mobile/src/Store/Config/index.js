import { buildSlice } from '@thecodingmachine/redux-toolkit-wrapper'
import ChangeBaseURL from './ChangeBaseURL'

// This state is common to all the "user" module, and can be modified by any "user" reducers
const sliceInitialState = {
  baseurl: 'http://192.168.0.107:3000',
}

export default buildSlice('config', [ChangeBaseURL], sliceInitialState).reducer
