import { combineReducers } from "redux"

import people from "./peopleReducer"
import faces from "./facesReducer"
import albums from './albumsReducer'

export default combineReducers({
  people,
  faces,
  albums,
})