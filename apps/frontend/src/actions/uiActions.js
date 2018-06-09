export function toggleSidebar() {
  return function(dispatch) {
    dispatch({type:"TOGGLE_SIDEBAR"})
  }
}
