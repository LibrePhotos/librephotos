import {
  buildAsyncState,
  buildAsyncActions,
  buildAsyncReducers,
} from '@thecodingmachine/redux-toolkit-wrapper'
import FetchOne from '@/Store/User/FetchOne'
import { navigateAndSimpleReset } from '@/Navigators/Root'
import DefaultTheme from '@/Store/Theme/DefaultTheme'

export default {
  initialState: buildAsyncState(),
  action: buildAsyncActions('startup/init', async (args, { dispatch }) => {
    // Timeout to fake waiting some process
    // Remove it, or keep it if you want display a beautiful splash screen ;)
    await new Promise(resolve => setTimeout(resolve, 1000))
    // Here we load the user 1 for example, but you can for example load the connected user
    await dispatch(FetchOne.action(1))
    await dispatch(DefaultTheme.action({ theme: 'default', darkMode: null }))
    // Navigate and reset to the main navigator
    // navigateAndSimpleReset('Main')
  }),
  reducers: buildAsyncReducers({ itemKey: null }), // We do not want to modify some item by default
}
