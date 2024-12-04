import { LEFT_MENU_WIDTH } from "../ui-constants";
import { DEFAULT_ACTION } from "./common";

const initialState = {
  showSidebar: true,
  showLightbox: false,
  contentWidth: window.innerWidth - 20,
  gridType: "loose",
  error: null,
};

export default function reducer(state = initialState, action = DEFAULT_ACTION) {
  switch (action.type) {
    case "TOGGLE_SIDEBAR": {
      const showSidebar = !state.showSidebar;
      const contentWidth = showSidebar ? window.innerWidth - LEFT_MENU_WIDTH : window.innerWidth;

      return {
        ...state,
        showSidebar: !state.showSidebar,
        contentWidth,
      };
    }

    case "SHOW_SIDEBAR": {
      return { ...state, showSidebar: true };
    }

    case "HIDE_SIDEBAR": {
      return { ...state, showSidebar: false };
    }

    case "TOGGLE_LIGHTBOX": {
      return { ...state, showLightbox: true };
    }

    case "HIDE_LIGHTBOX": {
      return { ...state, showLightbox: false };
    }

    case "SET_GRID_TYPE": {
      return { ...state, gridType: action.payload };
    }

    case "auth/logout":
      return { ...initialState };

    default: {
      return { ...state };
    }
  }
}
