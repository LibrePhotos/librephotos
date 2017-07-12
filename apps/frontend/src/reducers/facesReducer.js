export default function reducer(state={
    faces: [],
    faceToLabel: {},
    fetching: false,
    fetched: false,
    fetchingFaceToLabel: false,
    fetchedFaceToLabel: false,
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


      //FETCHING FACE
      case "FETCH_FACE_TO_LABEL": {
        return {...state, fetchingFaceToLabel: true}
      }
      case "FETCH_FACE_TO_LABEL_REJECTED": {
        return {...state, fetchingFaceToLabel: false, error: action.payload}
      }
      case "FETCH_FACE_TO_LABEL_FULFILLED": {
        return {
          ...state,
          fetchingFaceToLabel: false,
          fetchedFaceToLabel: true,
          faceToLabel: action.payload
        }
      }



      default: {
        return {...state}
      }
    }
}