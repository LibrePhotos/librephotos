import {
  buildAsyncState,
  buildAsyncActions,
  buildAsyncReducers,
} from '@thecodingmachine/redux-toolkit-wrapper'
import api from '@/Services'
import AuthUser from './AuthUser'

export default {
  initialState: buildAsyncState(),
  action: buildAsyncActions('auth/loginUser', async (args, { dispatch }) => {
    const username = args[0]
    const password = args[1]

    await api
      .post('/auth/token/obtain/', {
        username: username,
        password: password,
      })
      .then(response => {
        console.log('login successful', response.data)
        dispatch(AuthUser.action(response.data))
        dispatch(AuthUser.action({ isLoggedin: true }))
      })
  }),
  reducers: buildAsyncReducers({ itemKey: null }), // We do not want to modify some item by default
}
