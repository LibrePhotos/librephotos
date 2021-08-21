import { createAction } from '@reduxjs/toolkit'

export default {
  initialState: {},
  action: createAction('search/updateQuery'),
  reducers(state, { payload: { searchQuery } }) {
    console.log(searchQuery)
    if (typeof searchQuery !== 'undefined') {
      state.query = searchQuery

      if (searchQuery.length === 0) {
        console.log('Clearing results')
        state.searchResults = []
      }
    } else {
      state.query = ''
      state.searchResults = []
    }
  },
}
