export default function reducer(state={
    showSidebar: true,
    contentWidth: window.innerWidth-20,
    error: null,
  }, action) {

  switch (action.type) {
    case "TOGGLE_SIDEBAR": {
        const showSidebar = !state.showSidebar
        const contentWidth = showSidebar ? window.innerWidth - 85 : window.innerWidth 

        return {...state, showSidebar: !state.showSidebar, contentWidth:contentWidth}
    }

    default: {
      return {...state}
    }
  }
}
