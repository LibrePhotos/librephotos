import React from 'react'
import { connect } from 'react-redux'
import * as reducers from '../reducers'
// Router and Switch are needed Breaks site if not in import. DW
import {
  Route,
  Redirect
} from 'react-router-dom'


var topMenuHeight = 45 // don't change this
var leftMenuWidth = 85 // don't change this

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


const mapStateToProps = (state) => ({
      isAuthenticated: !reducers.isRefreshTokenExpired(state),
      showSidebar: state.ui.showSidebar
})

export default connect(mapStateToProps, null)(PrivateRoute);
