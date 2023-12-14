import { DEFAULT_ACTION } from "./common";

const initialState = {
  socialGraph: {},
  error: null,
  fetchingSocialGraph: false,
  fetchedSocialGraph: false,
};

export default function reducer(state = initialState, action = DEFAULT_ACTION) {
  switch (action.type) {
    case "FETCH_SOCIAL_GRAPH": {
      return { ...state, fetchingSocialGraph: true };
    }
    case "FETCH_SOCIAL_GRAPH_REJECTED": {
      return { ...state, fetchingSocialGraph: false, error: action.payload };
    }
    case "FETCH_SOCIAL_GRAPH_FULFILLED": {
      return {
        ...state,
        fetchingSocialGraph: false,
        fetchedSocialGraph: true,
        socialGraph: action.payload,
      };
    }

    case "auth/logout":
      return { ...initialState };

    default: {
      return { ...state };
    }
  }
}
