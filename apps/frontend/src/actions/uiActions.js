export function toggleSidebar() {
  return function cb(dispatch) {
    dispatch({ type: "TOGGLE_SIDEBAR" });
  };
}
