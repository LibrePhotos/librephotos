import React from 'react'
import { connect } from 'react-redux'
import * as reducers from '../reducers'
// Router and Switch are needed Breaks site if not in import. DW
import {
  BrowserRouter as Router,
  Route,
  Switch,
  Redirect
} from 'react-router-dom'
import {SideMenuNarrow, TopMenu} from './menubars'


var topMenuHeight = 45 // don't change this
var leftMenuWidth = 85 // don't change this
var leftMenuWidth = 85 // don't change this

      // <div>
      //   <Nav />
      //   <Component {...props}/>
      // </div>


const PrivateRoute = ({ component: Component, isAuthenticated, showSidebar, ...rest }) => {
  return (
    <Route {...rest} render={props => (
      isAuthenticated ? (
        <div>
          <div style={{paddingLeft:showSidebar ? leftMenuWidth+5 : 5,paddingRight:0}}>
            <div style={{paddingTop:topMenuHeight}}>
              <Component {...props}/>
            </div>
          </div>
        </div>
      ) : (
        <Redirect to={{
          pathname: '/login',
          state: { from: props.location }
        }}/>
      )
    )}/>
  )
}





class Nav extends React.Component {
  render() {
    return (
      <div>
        <SideMenuNarrow/>
        <TopMenu style={{zIndex:-1}}/>
      </div>
    )
  }
}


const mapStateToProps = (state) => ({
      isAuthenticated: !reducers.isRefreshTokenExpired(state),
      showSidebar: state.ui.showSidebar
})

export default connect(mapStateToProps, null)(PrivateRoute);
