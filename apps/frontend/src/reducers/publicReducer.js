const initialState = {
  publicUserList: [],
  fetchingPublicUserList: false,
  fetchedPublicUserList: false,

  error: null,
};

export default function reducer(
  state = initialState,
  action
) {
  switch (action.type) {
    case "FETCH_PUBLIC_USER_LIST": {
      return {
        ...state,
        fetchingPublicUserList: true,
      };
    }
    case "FETCH_PUBLIC_USER_LIST_FULFILLED": {
      return {
        ...state,
        fetchingPublicUserList: false,
        fetchedPublicUserList: false,
        publicUserList: action.payload,
      };
    }

    case "auth/logout":
      return { ...initialState };

    default: {
      return { ...state };
    }
  }
}
