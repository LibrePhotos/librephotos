export default function reducer(state={
    faces: [],
    fetching: false,
    fetched: false,
    error: null,
  }, action) {

    switch (action.type) {
      case "FETCH_FACES": {
        return {...state, fetching: true}
      }
      case "FETCH_FACES_REJECTED": {
        return {...state, fetching: false, error: action.payload}
      }
      case "FETCH_FACES_FULFILLED": {
        return {
          ...state,
          fetching: false,
          fetched: true,
          faces: action.payload,
        }
      }
      case "DELETE_FACE": {
        return {
          ...state,
          faces: state.faces.filter(element=>element.id !== action.payload)
        }
      }
      default: {
        return {...state}
      }
    }

    return state
}