import { combineReducers } from "redux"
import { routerReducer } from 'react-router-redux'
import { reducer as notificationsReducer } from 'reapop'
import people from "./peopleReducer"
import faces from "./facesReducer"
import albums from './albumsReducer'
import util from './utilReducer'
import photos from './photosReducer'
//import auth from './authReducer'
import auth, * as fromAuth from './authReducer'
import search from './searchReducer'
import ui from './uiReducer'
import pub from './publicReducer'
import user from './userReducer'


const appReducer = combineReducers({
  people,
  faces,
  albums,
  util,
  photos,
  auth,
  search,
  routerReducer,
  ui,
  pub,
  user,
  notifications: notificationsReducer()
  
})

export default (state,action) => {
	if (action.type === 'LOGOUT') {
		state = {}
	}

	return appReducer(state,action)
}

export const isAuthenticated =
    state => fromAuth.isAuthenticated(state.auth)
export const accessToken = 
    state => fromAuth.accessToken(state.auth)
export const isAccessTokenExpired =
    state => fromAuth.isAccessTokenExpired(state.auth)
export const refreshToken =
    state => fromAuth.refreshToken(state.auth)
export const isRefreshTokenExpired =
    state => fromAuth.isRefreshTokenExpired(state.auth)
export const authErrors =
    state => fromAuth.errors(state.auth)

export function withAuth(headers) {
  return (state) => { 
    return ({
      ...headers,
      'Authorization': `Bearer ${accessToken(state)}`
    })
  }
}
