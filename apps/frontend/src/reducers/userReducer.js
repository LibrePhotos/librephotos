export default function reducer(
  state = {
    userDetails: {},
    fetchingUserDetails: false,
    fetchedUserDetails: false,

    userSelfDetails: {},
    fetchingUserSelfDetails: false,
    fetchedUserSelfDetails: false,

    error: null
  },
  action
) {
  switch (action.type) {
    case "FETCH_USER_SELF_DETAILS": {
      return { ...state, fetchingUserSelfDetails: true };
    }
    case "FETCH_USER_SELF_DETAILS_FULFILLED": {
      return {
        ...state,
        fetchingUserSelfDetails: false,
        fetchedUserSelfDetails: true,
        userSelfDetails: action.payload
      };
    }
    case "FETCH_USER_SELF_DETAILS_REJECTED": {
      return { ...state, fetchingUserDetails: false, error: action.payload };
    }

    default: {
      return { ...state };
    }
  }
}
