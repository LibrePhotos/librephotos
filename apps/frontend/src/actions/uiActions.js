export function toggleSidebar() {
  return function (dispatch) {
    dispatch({ type: "TOGGLE_SIDEBAR" });
  };
}

export function toggleLightbox() {
  return function (dispatch) {
    dispatch({ type: "TOGGLE_LIGHTBOX" });
  };
}

export function hideLightbox() {
  return function (dispatch) {
    dispatch({ type: "HIDE_LIGHTBOX" });
  };
}
