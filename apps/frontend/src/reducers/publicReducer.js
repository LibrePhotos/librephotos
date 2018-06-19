export default function reducer(
  state = {
    userPublicPhotos: {},
    fetchingUserPublicPhotos: false,
    fetchedUserPublicPhotos: false,

    publicUserList: [],
    fetchingPublicUserList: false,
    fetchedPublicUserList: false,

    error: null
  },
  action
) {
  switch (action.type) {
    case "FETCH_USER_PUBLIC_PHOTOS": {
      return {
        ...state,
        fetchingUserPublicPhotos: true
      };
    }
    case "FETCH_USER_PUBLIC_PHOTOS_FULFILLED": {
      return {
        ...state,
        fetchingUserPublicPhotos: false,
        fetchedUserPublicPhotos: false,
        userPublicPhotos: {
          ...state.userPublicPhotos,
          [action.payload.user]: action.payload.photos
        }
      };
    }


    case "FETCH_PUBLIC_USER_LIST": {
      return {
        ...state,
        fetchingPublicUserList: true
      };
    }
    case "FETCH_PUBLIC_USER_LIST_FULFILLED": {
      return {
        ...state,
        fetchingPublicUserList: false,
        fetchedPublicUserList: false,
        publicUserList: action.payload
      };
    }



    default: {
      return { ...state };
    }
  }
}
