export default function reducer(state={
    people: [],
    socialGraph: {},
    egoGraph: {},
    fetching: false,
    fetched: false,
    adding: false,
    added: false,
    error: null,
    fetchingSocialGraph: false,
    fetchedSocialGraph: false,
    fetchingEgoGraph: false,
    fetchedEgoGraph: false,
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
        const newState = Object.assign({}, state, {adding:false}, {added:true})
        newState.people = state.people.concat(action.payload)
        return newState
      }


      case "ADD_PERSON_AND_SET_FACE_LABEL": {
        return {...state, adding: true}
      }
      case "ADD_PERSON_AND_SET_FACE_LABEL_REJECTED": {
        return {...state, adding: false, error: action.payload}
      }
      case "ADD_PERSON_AND_SET_FACE_LABEL_FULFILLED": {
        const newState = Object.assign({}, state, {adding:false}, {added:true})
        newState.people = state.people.concat(action.payload)
        return newState
      }




      case "FETCH_SOCIAL_GRAPH": {
        return {...state, fetchingSocialGraph: true}
      }
      case "FETCH_SOCIAL_GRAPH_REJECTED": {
        return {...state, fetchingSocialGraph: false, error: action.payload}
      }
      case "FETCH_SOCIAL_GRAPH_FULFILLED": {
        return {
          ...state,
          fetchingSocialGraph: false,
          fetchedSocialGraph: true,
          socialGraph: action.payload,
        }
      }





      case "FETCH_EGO_GRAPH": {
        return {...state, fetchingEgoGraph: true}
      }
      case "FETCH_EGO_GRAPH_REJECTED": {
        return {...state, fetchingEgoGraph: false, error: action.payload}
      }
      case "FETCH_EGO_GRAPH_FULFILLED": {
        return {
          ...state,
          fetchingEgoGraph: false,
          fetchedEgoGraph: true,
          egoGraph: {...state.egoGraph, [action.payload.person_id]:action.payload.data},
        }
      }








      default: {
        return {...state}
      }
    }
}

