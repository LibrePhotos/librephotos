export default function reducer(state={
    faces: [],
    fetching: false,
    fetched: false,
    error: null,
  }, action) {

    switch (action.type) {
      case "FETCH_FACES": {
        console.log('fetch faces from reducer')
        return {...state, fetching: true}
      }
      case "FETCH_FACES_REJECTED": {
        console.log('fetch faces rejected')
        return {...state, fetching: false, error: action.payload}
      }
      case "FETCH_FACES_FULFILLED": {
        console.log('fetch faces fulfilled',action.payload)
        return {
          ...state,
          fetching: false,
          fetched: true,
          faces: action.payload,
        }
      }
      case "DELETE_FACE": {
        console.log('from reducer: delete face',action.payload)
        console.log(action)
        return {
          ...state,
          faces: state.faces.filter(element=>element.id !== action.payload)
        }
      }
      default: {
        console.log('default reducer faces')
        return {...state}
      }
    }

    return state
}