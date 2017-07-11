import { combineReducers } from "redux"

import people from "./peopleReducer"
import faces from "./facesReducer"

export default combineReducers({
  people,
  faces
})