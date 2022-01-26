export default function reducer(
  state = {
    publicUserList: [],
    fetchingPublicUserList: false,
    fetchedPublicUserList: false,

    error: null,
  },
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

    default: {
      return { ...state };
    }
  }
}
