import {
  buildAsyncState,
  buildAsyncActions,
  buildAsyncReducers,
} from '@thecodingmachine/redux-toolkit-wrapper'
import AuthUser from './AuthUser'
import { UpdateToken } from '@/Services/Auth'

export default {
  initialState: buildAsyncState(),
  action: buildAsyncActions('auth/updateToken', async (args, { dispatch }) => {
    return await UpdateToken().then(response => {
      dispatch(AuthUser.action(response.data))
    })
  }),
  reducers: buildAsyncReducers({ itemKey: null }), // We do not want to modify some item by default
}
