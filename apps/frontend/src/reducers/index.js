import { combineReducers } from "redux"

import people from "./peopleReducer"
import faces from "./facesReducer"
import albums from './albumsReducer'
import util from './utilReducer'
import photos from './photosReducer'
import auth from './authReducer'
import search from './searchReducer'


const appReducer = combineReducers({
  people,
  faces,
  albums,
  util,
  photos,
  auth,
  search,
})

export default (state,action) => {
	if (action.type === 'LOGOUT') {
		state = {}
	}

	return appReducer(state,action)
}