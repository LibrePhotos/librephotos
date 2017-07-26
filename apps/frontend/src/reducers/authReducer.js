export default function reducer(state={
    jwtToken: null,
    error: null,
  }, action) {

  switch (action.type) {
  	case "LOGIN_FULFILLED": {
  		return {...state, jwtToken: 'JWT '+action.payload}
  	}

    case "LOGOUT": {
      console.log('from reducer, logging out')
      return { jwtToken: null}      
    }

    default: {
      return {...state}
    }
  }
}
