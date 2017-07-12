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
        const newState = Object.assign({},state, {fetching:false}, {fetched:true})
        newState.people = [].concat(action.payload)
        return newState
        // return {
        //   ...state,
        //   fetching: false,
        //   fetched: true,
        //   people: action.payload,
        // }
      }
      case "ADD_PERSON": {
        return {...state, adding: true}

      }
      case "ADD_PERSON_REJECTED": {
        return {...state, adding: false, error: action.payload}
      }
      case "ADD_PERSON_FULFILLED": {
        const newState = Object.assign({}, state, {adding:false}, {added:true})
        newState.people = state.people.concat(action.payload)
        return newState
      }

      default: {
        return {...state}
      }
    }
}