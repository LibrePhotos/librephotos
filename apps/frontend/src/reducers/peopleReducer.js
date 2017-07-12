export default function reducer(state={
    people: [],
    fetching: false,
    fetched: false,
    adding: false,
    added: false,
    error: null,
  }, action) {

    switch (action.type) {
      case "FETCH_PEOPLE": {
        return {...state, fetching: true}
      }
      case "FETCH_PEOPLE_REJECTED": {
        return {...state, fetching: false, error: action.payload}
      }
      case "FETCH_PEOPLE_FULFILLED": {
        return {
          ...state,
          fetching: false,
          fetched: true,
          people: action.payload,
        }
      }
      case "ADD_PERSON": {
        return {...state, adding: true}

      }
      case "ADD_PERSON_REJECTED": {
        return {...state, adding: false, error: action.payload}
      }
      case "ADD_PERSON_FULFILLED": {
        return {
          ...state,
          adding: false,
          added: true,
          people: [action.payload, ...state.people]
        }
      }
      default: {
        return {...state}
      }
    }

    return state
}