export default function reducer(
  state = {
    userDetails: {},
    fetchingUserDetails: false,
    fetchedUserDetails: false,
    defaultRules: undefined,
    userSelfDetails: {},
    fetchingUserSelfDetails: false,
    fetchedUserSelfDetails: false,

    error: null,
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
        userSelfDetails: action.payload,
      };
    }
    case "FETCH_USER_SELF_DETAILS_REJECTED": {
      return { ...state, fetchingUserDetails: false, error: action.payload };
    }

    case "UPDATE_USER_FULFILLED": {
      let newState = {
        ...state,
      };
      if (action.payload.favorite_min_rating !== undefined) {
        newState.userSelfDetails.favorite_min_rating =
          action.payload.favorite_min_rating;
      }
      if (action.payload.save_metadata_to_disk !== undefined) {
        newState.userSelfDetails.save_metadata_to_disk =
          action.payload.save_metadata_to_disk;
      }
      return newState;
    }

    case "FETCH_DEFAULT_RULES_FULFILLED": {
      return {
        ...state,
        defaultRules: JSON.parse(action.payload ? action.payload : "[]"),
      };
    }

    default: {
      return { ...state };
    }
  }
}
