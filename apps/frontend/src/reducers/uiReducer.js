export default function reducer(
  state = {
    showSidebar: true,
    showLightbox: false,
    contentWidth: window.innerWidth - 20,
    gridType: "loose",
    error: null,
  },
  action
) {
  switch (action.type) {
    case "TOGGLE_SIDEBAR": {
      const showSidebar = !state.showSidebar;
      const contentWidth = showSidebar ? window.innerWidth - 85 : window.innerWidth;

      return {
        ...state,
        showSidebar: !state.showSidebar,
        contentWidth: contentWidth,
      };
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

    default: {
      return { ...state };
    }
  }
}
