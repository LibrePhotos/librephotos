import { buildSlice } from '@thecodingmachine/redux-toolkit-wrapper'
import AuthUser from './AuthUser'
import LoginUser from './LoginUser'
import LogoutUser from './LogoutUser'

// This state is common to all the "user" module, and can be modified by any "user" reducers
const sliceInitialState = {
  authData: {},
}

export default buildSlice(
  'auth',
  [AuthUser, LoginUser, LogoutUser],
  sliceInitialState,
).reducer
