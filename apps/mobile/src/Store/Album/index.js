import { buildSlice } from '@thecodingmachine/redux-toolkit-wrapper'
import FetchByDate from './FetchByDate'

// This state is common to all the "user" module, and can be modified by any "user" reducers
const sliceInitialState = {
  albumByDate: {},
}

export default buildSlice('album', [FetchByDate], sliceInitialState).reducer
