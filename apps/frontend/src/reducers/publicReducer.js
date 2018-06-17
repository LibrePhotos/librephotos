export default function reducer(
  state = {
    userPublicPhotos: {},
    fetchingUserPublicPhotos: false,
    fetchedUserPublicPhotos: false,
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

    default: {
      return { ...state };
    }
  }
}
