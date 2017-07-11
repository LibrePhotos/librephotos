export default function reducer(state={
    people: [],
    fetching: false,
    fetched: false,
    error: null,
  }, action) {

    switch (action.type) {
      case "FETCH_PEOPLE": {
        console.log('fetch people from reducer')
        return {...state, fetching: true}
      }
      case "FETCH_PEOPLE_REJECTED": {
        console.log('fetch people rejected')
        return {...state, fetching: false, error: action.payload}
      }
      case "FETCH_PEOPLE_FULFILLED": {
        console.log('fetch people fulfilled')
        return {
          ...state,
          fetching: false,
          fetched: true,
          people: action.payload,
        }
      }
      default: {
        console.log('default reducer')
        return {...state}
      }
    }

    return state
}